// Freio único da DM da OPI (Frente C, 02/11/2026): /pausar_dm e /retomar_dm no bot do Telegram (n8n)
// chamam app/api/opi/dm. Pausar desliga todas as campanhas ativas e guarda quais foram; retomar religa só
// essas. Uma campanha que já estava desligada (por exemplo, pela pausa da 1ª DM) nunca é religada aqui, nem uma
// que o Luan mexeu no painel durante a pausa. O estado fica em OperationalEvent (sem migração): o último evento
// opi.freio.* manda. Rode dentro de uma transação (a rota usa prisma.$transaction).
import { timingSafeEqual } from "node:crypto";
import type { Prisma } from "@/app/generated/prisma/client";

export const EVENTO_PAUSAR = "opi.freio.pausar";
export const EVENTO_RETOMAR = "opi.freio.retomar";

export type DbFreio = Pick<Prisma.TransactionClient, "automation" | "operationalEvent" | "$executeRaw">;

// Chave fixa do advisory lock: dois comandos do freio ao mesmo tempo rodam um depois do outro.
const TRAVA_FREIO = 730_110_201;

export type ResultadoFreio = {
  acao: "pausar" | "retomar" | "status";
  pausado: boolean;
  alteradas: number;
  ativas: number;
  guardadas: number;
  // Retomar: campanhas da lista que não foram religadas porque mudaram no painel durante a pausa.
  mexidasNoPainel: number;
};

type PayloadFreio = { ids: string[]; em: string };

function escopo(workspaceId: string | null) {
  return workspaceId ? { workspaceId } : {};
}

// Leitura do estado: eventos do workspace OU sem workspace, para o estado não sumir se OPI_FREIO_WORKSPACE_ID for
// definido depois de já existirem eventos.
function escopoEventos(workspaceId: string | null) {
  return workspaceId ? { OR: [{ workspaceId }, { workspaceId: null }] } : {};
}

async function ultimoEvento(db: Pick<DbFreio, "operationalEvent">, workspaceId: string | null) {
  return db.operationalEvent.findFirst({
    where: { ...escopoEventos(workspaceId), message: { in: [EVENTO_PAUSAR, EVENTO_RETOMAR] } },
    orderBy: { createdAt: "desc" },
    select: { message: true, payload: true },
  });
}

/**
 * Freio global: com o último evento = pausar, nenhuma DM nem resposta pública automática sai, mesmo de campanha
 * reativada ou criada no painel durante a pausa. O worker consulta isto logo antes de cada envio.
 */
export async function freioPuxado(db: Pick<DbFreio, "operationalEvent">, workspaceId: string | null): Promise<boolean> {
  return (await ultimoEvento(db, workspaceId))?.message === EVENTO_PAUSAR;
}

function lerPayload(payload: unknown): PayloadFreio {
  const p = (payload ?? {}) as { ids?: unknown; em?: unknown };
  const ids = Array.isArray(p.ids) ? p.ids.filter((x): x is string => typeof x === "string") : [];
  return { ids, em: typeof p.em === "string" ? p.em : "" };
}

export async function executarFreio(
  db: DbFreio,
  acao: "pausar" | "retomar" | "status",
  workspaceId: string | null,
  agora: () => Date = () => new Date(),
): Promise<ResultadoFreio> {
  // Serializa os comandos do freio (a trava cai no fim da transação). Os eventos levam createdAt explícito, tirado
  // depois da trava: o default do banco é a hora de INÍCIO da transação e embaralharia a ordem.
  await db.$executeRaw`SELECT pg_advisory_xact_lock(${TRAVA_FREIO}::bigint)`;
  const ultimo = await ultimoEvento(db, workspaceId);
  const pausadoAntes = ultimo?.message === EVENTO_PAUSAR;
  const antes = pausadoAntes ? lerPayload(ultimo?.payload) : { ids: [], em: "" };

  if (acao === "pausar") {
    const ativas = await db.automation.findMany({ where: { ...escopo(workspaceId), isActive: true }, select: { id: true } });
    // Uma a uma, condicionada a isActive=true: só entra na lista o que ESTE comando desligou. Uma campanha que o
    // worker pausou na 1ª DM entre o findMany e aqui não entra, e o /retomar_dm não a religa sem a Compliance.
    const desligadas: string[] = [];
    for (const { id } of ativas) {
      const r = await db.automation.updateMany({ where: { id, isActive: true }, data: { isActive: false } });
      if (r.count === 1) desligadas.push(id);
    }
    // "em" vem depois dos updates: o que o painel mudar a partir daqui tem updatedAt maior.
    const em = agora();
    const payload: PayloadFreio = { ids: [...new Set([...antes.ids, ...desligadas])], em: em.toISOString() };
    await db.operationalEvent.create({
      data: { ...escopo(workspaceId), source: "SYSTEM", level: "WARNING", message: EVENTO_PAUSAR, payload, createdAt: em },
    });
    return { acao, pausado: true, alteradas: desligadas.length, ativas: 0, guardadas: payload.ids.length, mexidasNoPainel: 0 };
  }

  if (acao === "retomar") {
    let alteradas = 0;
    let mexidas = 0;
    if (pausadoAntes && antes.ids.length) {
      const desde = antes.em ? new Date(antes.em) : null;
      const intactas = { id: { in: antes.ids }, isActive: false, ...(desde ? { updatedAt: { lte: desde } } : {}) };
      alteradas = (await db.automation.updateMany({ where: intactas, data: { isActive: true } })).count;
      if (desde) {
        mexidas = await db.automation.count({ where: { id: { in: antes.ids }, isActive: false, updatedAt: { gt: desde } } });
      }
    }
    if (pausadoAntes) {
      const em = agora();
      await db.operationalEvent.create({
        data: { ...escopo(workspaceId), source: "SYSTEM", level: "INFO", message: EVENTO_RETOMAR, payload: { ids: antes.ids, em: em.toISOString() }, createdAt: em },
      });
    }
    const ativas = await db.automation.count({ where: { ...escopo(workspaceId), isActive: true } });
    return { acao, pausado: false, alteradas, ativas, guardadas: 0, mexidasNoPainel: mexidas };
  }

  const ativas = await db.automation.count({ where: { ...escopo(workspaceId), isActive: true } });
  return { acao, pausado: pausadoAntes, alteradas: 0, ativas, guardadas: antes.ids.length, mexidasNoPainel: 0 };
}

/** Bearer igual a OPI_FREIO_SECRET (mín. 32 caracteres). Sem segredo configurado, a rota fica fechada. */
export function autorizadoFreio(header: string | null, segredo: string | undefined): "ok" | "sem_segredo" | "negado" {
  const s = (segredo ?? "").trim();
  if (s.length < 32) return "sem_segredo";
  const token = header?.match(/^Bearer (.+)$/)?.[1] ?? "";
  const a = Buffer.from(token);
  const b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "negado";
}
