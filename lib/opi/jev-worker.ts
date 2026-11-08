// Ligação do portão do Jev (lib/opi/jev-gate.ts) com o worker de DM: grava a decisão no DmLog e no JevLedger,
// avisa o Luan no Telegram e aplica a pausa da 1ª DM. Mantém a mudança em lib/queue/dm-worker.ts mínima.
import { prisma } from "@/lib/db/client";
import {
  avaliarComentario,
  avisarTelegram,
  foraDaJanela,
  gateLigado,
  hashTemplate,
  linhasLedger,
  mensagemPausa,
  mensagemPrimeiraDmFalhou,
  mensagemSemCampanha,
  mensagemTelegram,
  motivoCampanhaNaoConforme,
  pausaPrimeiraDmLigada,
  reservarPrimeiraDm,
  respostasPublicasPermitidas,
  type CampanhaConfig,
  type FetchLike,
  type TelegramFetch,
} from "./jev-gate";
import { freioPuxado } from "./freio";

const workspaceFreio = () => process.env.OPI_FREIO_WORKSPACE_ID?.trim() || null;

export type PortaoAutomation = CampanhaConfig & {
  id: string;
  name: string;
  workspaceId: string;
  instagramAccountId: string;
  keywords: string[];
  matchAnyWord: boolean;
};

export type PortaoEntrada = {
  automation: PortaoAutomation;
  commentId: string; // id do comentário, ou "dm:<mid>" no gatilho por DM
  texto: string;
  commenterId: string;
  commenterName: string | null;
  matchedKeyword: string | null;
  origem: "comentário" | "DM";
  // Horário do comentário (vem do reconciliador; o webhook chega na hora). Acima de 7 dias: lista manual.
  commentTimestamp?: string | null;
  // DmLog já existente para (automation, commentId): reaproveita a decisão "enviar" sem chamar o Jev de novo.
  jevDecisionAnterior?: string | null;
};

const fetchJev: FetchLike = (url, init) => fetch(url, init);
const fetchTelegram: TelegramFetch = (url, init) => fetch(url, init);

// ---- Avisos no Telegram ----
// Prioritários (caso segurado, 1ª DM): sem teto, um por comentário. Comuns ("sem campanha"): no máximo 20 a cada
// 10 min por worker, para a estreia de um Reel não virar centenas de mensagens; o excedente é contado no próximo
// aviso e cada um fica em OperationalEvent (Logs). Todo aviso sai em fila, no máximo 1 por segundo (limite do
// Telegram por chat). Aviso que falhou fica em OperationalEvent (com o texto já mascarado) e é reenviado pelo ciclo
// do reconciliador (reenviarAvisosPendentes), até sair.
const AVISO_LIMITE = 20;
const AVISO_JANELA_MS = 10 * 60_000;
const AVISO_DEDUP_MS = 60 * 60_000;
export const EVENTO_AVISO_FALHOU = "opi.telegram.falhou";
export const EVENTO_AVISO_SUPRIMIDO = "opi.telegram.suprimido";
const avisados = new Map<string, number>();
let janelaInicio = 0;
let enviadosNaJanela = 0;
let suprimidos = 0;
let filaTelegram: Promise<unknown> = Promise.resolve();

/** Só para testes: zera o limitador e a deduplicação. */
export function zerarAvisosParaTeste() {
  avisados.clear();
  janelaInicio = 0;
  enviadosNaJanela = 0;
  suprimidos = 0;
  filaTelegram = Promise.resolve();
}

function intervaloTelegramMs() {
  const v = Number(process.env.OPI_TELEGRAM_INTERVALO_MS ?? 1000);
  return Number.isFinite(v) && v >= 0 ? v : 1000;
}

// Envia em fila, um por vez, com o intervalo mínimo entre envios.
function enviarNaFila(texto: string): Promise<boolean> {
  const envio = filaTelegram.then(() => avisarTelegram(texto, process.env, fetchTelegram));
  const espera = intervaloTelegramMs();
  filaTelegram = envio.catch(() => false).then(() => (espera ? new Promise((r) => setTimeout(r, espera)) : undefined));
  return envio;
}

type Registro = { commentId?: string; tipo: string; decisao?: string };

async function registrar(message: string, level: "INFO" | "WARNING", r: Registro, texto: string) {
  try {
    await prisma.operationalEvent.create({
      data: {
        source: "WORKER",
        level,
        message,
        payload: {
          ...r,
          texto,
          telegramConfigurado: Boolean(process.env.OPI_TELEGRAM_BOT_TOKEN && process.env.OPI_TELEGRAM_CHAT_ID),
        },
      },
    });
  } catch {
    // Um erro aqui nunca derruba o job.
  }
}

/**
 * Reenvia avisos que falharam no Telegram (até 10 por ciclo, dos últimos 3 dias, mais antigos primeiro).
 * Entregue = resolvedAt. Roda no ciclo do reconciliador (worker/dm-worker.ts). Com o portão desligado, não faz nada.
 */
export async function reenviarAvisosPendentes(): Promise<{ reenviados: number; pendentes: number }> {
  if (!gateLigado() || !process.env.OPI_TELEGRAM_BOT_TOKEN || !process.env.OPI_TELEGRAM_CHAT_ID) return { reenviados: 0, pendentes: 0 };
  const pendentes = await prisma.operationalEvent.findMany({
    where: {
      // Só os que falharam. Os suprimidos pelo teto ficam em Logs (reenviá-los anularia o teto).
      message: EVENTO_AVISO_FALHOU,
      resolvedAt: null,
      createdAt: { gte: new Date(Date.now() - 3 * 86400_000) },
    },
    orderBy: { createdAt: "asc" },
    take: 10,
    select: { id: true, payload: true },
  });
  let reenviados = 0;
  for (const ev of pendentes) {
    const texto = (ev.payload as { texto?: unknown } | null)?.texto;
    if (typeof texto !== "string" || !texto) {
      await prisma.operationalEvent.update({ where: { id: ev.id }, data: { resolvedAt: new Date() } });
      continue;
    }
    if (!(await enviarNaFila(`(Aviso atrasado)\n${texto}`))) break; // Telegram ainda fora: tenta no próximo ciclo
    await prisma.operationalEvent.update({ where: { id: ev.id }, data: { resolvedAt: new Date() } });
    reenviados++;
  }
  return { reenviados, pendentes: pendentes.length };
}

async function avisar(texto: string, r: Registro, opts: { comum?: boolean } = {}) {
  const agora = Date.now();
  const chave = r.commentId ? `${r.tipo}:${r.commentId}` : null;
  if (chave) {
    for (const [k, t] of avisados) if (agora - t > AVISO_DEDUP_MS) avisados.delete(k);
    if (avisados.has(chave)) return;
  }
  let prefixo = "";
  if (opts.comum) {
    if (agora - janelaInicio > AVISO_JANELA_MS) {
      janelaInicio = agora;
      enviadosNaJanela = 0;
    }
    if (enviadosNaJanela >= AVISO_LIMITE) {
      suprimidos++;
      await registrar(EVENTO_AVISO_SUPRIMIDO, "INFO", r, texto);
      return;
    }
    enviadosNaJanela++;
    if (suprimidos) {
      prefixo = `(${suprimidos} aviso(s) de "sem campanha" não enviado(s) pelo limite de ${AVISO_LIMITE} a cada 10 min; estão em Logs no painel, com o id do comentário.)\n\n`;
      suprimidos = 0;
    }
  }
  const ok = await enviarNaFila(prefixo + texto);
  if (chave) avisados.set(chave, agora); // entregue, ou registrado abaixo para o reenvio: não duplica
  if (!ok) await registrar(EVENTO_AVISO_FALHOU, "WARNING", r, texto);
}

function logBase(e: PortaoEntrada) {
  return {
    workspaceId: e.automation.workspaceId,
    automationId: e.automation.id,
    instagramAccountId: e.automation.instagramAccountId,
    commenterId: e.commenterId,
    commenterName: e.commenterName,
    commentText: e.texto,
    commentId: e.commentId,
    matchedKeyword: e.matchedKeyword,
  };
}

async function segurar(e: PortaoEntrada, decisao: string, motivo: string, scores: Record<string, number | null> | null) {
  const where = { automationId_commentId: { automationId: e.automation.id, commentId: e.commentId } };
  const jev = { jevDecision: decisao, jevReason: motivo.slice(0, 1000), ...(scores ? { jevScores: scores } : {}) };
  const atual = await prisma.dmLog.findUnique({ where, select: { status: true } });
  if (atual?.status === "SENT") {
    // A DM já saiu: registra a decisão, mas não rebaixa o status (contagem de SENT e pausa da 1ª DM dependem dele).
    await prisma.dmLog.update({ where, data: jev });
  } else {
    const campos = { status: "HELD_FOR_REVIEW" as const, ...jev, errorMessage: `OPI: segurado para revisão (${decisao})` };
    await prisma.dmLog.upsert({ where, create: { ...logBase(e), ...campos }, update: campos });
  }
  await avisar(
    mensagemTelegram({
      campanha: e.automation.name, usuario: e.commenterName, texto: e.texto, decisao, motivo, origem: e.origem,
      commentId: e.commentId, p: scores, dmJaEnviada: atual?.status === "SENT",
    }),
    { commentId: e.commentId, tipo: "segurado", decisao },
  );
}

/**
 * Decide se este comentário/mensagem pode receber DM e resposta pública. true = liberado (o DmLog já leva a
 * decisão do Jev); false = segurado (DmLog em HELD_FOR_REVIEW, ledger gravado e Luan avisado).
 * A pausa da 1ª DM e o freio são conferidos depois, no momento do envio (reservarEnvio).
 * Com OPI_JEV_GATE=off devolve true sem fazer nada.
 */
export async function aplicarPortaoJev(e: PortaoEntrada): Promise<boolean> {
  if (!gateLigado()) return true;

  // Textos aprovados no painel. Sem a tabela (ou com erro de banco) vale só a lista fixa: o portão nunca afrouxa.
  let extras: { palavra: string; dmMessage: string }[] = [];
  try {
    extras = (await prisma.textoAprovado?.findMany({
      where: { workspaceId: e.automation.workspaceId, ativo: true },
      select: { palavra: true, dmMessage: true },
    })) ?? [];
  } catch {
    extras = [];
  }
  const naoConforme = motivoCampanhaNaoConforme(
    e.automation,
    new Map(extras.map((t) => [hashTemplate(t.dmMessage), t.palavra] as const)),
  );
  if (naoConforme) {
    await segurar(e, "bloqueado_template", `campanha fora do aprovado: ${naoConforme}`, null);
    return false;
  }
  if (foraDaJanela(e.commentTimestamp)) {
    await segurar(e, "fora_da_janela", "comentário com mais de 7 dias (PARECER §8.2-3): só resposta manual", null);
    return false;
  }

  if (e.jevDecisionAnterior !== "enviar") {
    const a = await avaliarComentario({
      texto: e.texto,
      palavrasChave: e.automation.keywords,
      matchAnyWord: e.automation.matchAnyWord,
      apiKey: process.env.TYPESAFE_API_KEY,
      fetchImpl: fetchJev,
    });
    await prisma.jevLedger.createMany({
      data: linhasLedger(a, {
        workspaceId: e.automation.workspaceId,
        automationId: e.automation.id,
        commentId: e.commentId,
        texto: e.texto,
      }),
    });
    if (a.decisao !== "enviar") {
      await segurar(e, a.decisao, a.motivo, a.p);
      return false;
    }
    const campos = { jevDecision: a.decisao, jevReason: a.motivo, jevScores: a.p };
    await prisma.dmLog.upsert({
      where: { automationId_commentId: { automationId: e.automation.id, commentId: e.commentId } },
      create: { ...logBase(e), status: "PENDING", ...campos },
      update: campos,
    });
  }
  return true;
}

/**
 * Chamado imediatamente antes de enviar a DM (depois de credencial, dedup, limites e fila).
 * - "nao": freio puxado (global: vale até para campanha reativada no painel durante a pausa) ou campanha desligada.
 *   O DmLog fica PENDING e o reconciliador traz o comentário de volta quando a campanha e o freio voltarem.
 * - "primeira": pausa da 1ª DM ligada e esta é a 1ª DM deste texto; a campanha acabou de ser desativada por ESTE
 *   job, que envia só esta. Depois do envio, o worker chama avisarPrimeiraDm (ou avisarPrimeiraDmFalhou).
 * - "ok": pode enviar.
 */
export async function reservarEnvio(a: { id: string; dmMessage: string }): Promise<"nao" | "primeira" | "ok"> {
  if (!gateLigado()) return "ok";
  if (await freioPuxado(prisma, workspaceFreio())) return "nao";
  if (pausaPrimeiraDmLigada()) {
    const r = await reservarPrimeiraDm(prisma, a.id, hashTemplate(a.dmMessage));
    return r === "pausada" ? "nao" : r === "primeira" ? "primeira" : "ok";
  }
  return (await prisma.automation.count({ where: { id: a.id, isActive: true } })) > 0 ? "ok" : "nao";
}

/** 1ª DM deste texto enviada (SENT): avisa que a campanha está pausada para a Compliance conferir. */
export async function avisarPrimeiraDm(a: { name: string }, commenterName: string | null, commentId: string) {
  await avisar(mensagemPausa({ campanha: a.name, usuario: commenterName }), { commentId, tipo: "primeira_dm" });
}

/** A 1ª DM não saiu (ou a entrega não foi confirmada): a campanha ficou pausada. */
export async function avisarPrimeiraDmFalhou(a: { name: string }, commenterName: string | null, commentId: string, incerta = false) {
  await avisar(mensagemPrimeiraDmFalhou({ campanha: a.name, usuario: commenterName, incerta }), { commentId, tipo: "primeira_dm_falhou" });
}

/** Resposta pública de um comentário cuja DM já saiu antes: não sai com o freio puxado. */
export async function respostaPublicaLiberada(): Promise<boolean> {
  return !gateLigado() || !(await freioPuxado(prisma, workspaceFreio()));
}

/**
 * Envios fora do comentário (toque em botão de abertura/"seguir", follow-up): com o portão ligado, nunca saem.
 * Campanha conforme nunca manda botão nem follow-up; um botão antigo não pode furar o Jev, o freio nem a pausa.
 */
export function envioExtraBloqueado(_a?: CampanhaConfig): boolean {
  return gateLigado();
}

/** Hash do texto enviado, gravado no DmLog de cada envio (PARECER §8.2-6). Undefined com o portão desligado. */
export function templateDoEnvio(dmMessage: string): string | undefined {
  return gateLigado() ? hashTemplate(dmMessage) : undefined;
}

/** Com o portão ligado, a resposta pública só sai depois da DM confirmada (SENT): nunca afirma o que não houve. */
export function respostaPublicaSoAposDm(): boolean {
  return gateLigado();
}

/** Resposta pública: com o portão ligado, só a frase aprovada (FRASE_RESPOSTA_PUBLICA). */
export function filtrarRespostaPublica(pool: readonly string[]): string[] {
  return respostasPublicasPermitidas(pool, process.env);
}

/** Comentário que nenhuma campanha ativa casou: avisa o Luan no Telegram. Com o portão desligado, não faz nada. */
export async function avisarComentarioSemCampanha(x: { commentId: string; commenterName: string | null; texto: string; mediaId: string }): Promise<void> {
  if (!gateLigado()) return;
  await avisar(
    mensagemSemCampanha({ usuario: x.commenterName, texto: x.texto, midia: x.mediaId }),
    { commentId: x.commentId, tipo: "sem_campanha" },
    { comum: true },
  );
}
