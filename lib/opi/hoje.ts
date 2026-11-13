// Bloco "Hoje" do Dashboard: o que sai hoje (em São Paulo), o que deu erro nas últimas 24 h e o que espera o Luan.
// Só leitura. Cada consulta é isolada com bloco(): se uma falhar, as outras aparecem.
// Nada de nome de pessoa: do DmLog e do OperationalEvent saem só contagens.
import type { PrismaClient } from "@/app/generated/prisma/client";
import { PREFIXO_ALVO, alvoAgendado } from "@/lib/opi/campanha-alvo";
import { bloco, janelas, LINKS, truncar, type Bloco } from "@/lib/opi/visao-geral";

export type DbHoje = Pick<PrismaClient, "postAgendado" | "automation" | "dmLog" | "operationalEvent">;

const DIA_MS = 24 * 60 * 60 * 1000;
const LINK_DIAGNOSTICO = "/diagnostics";

export type PostDeHoje = {
  id: string;
  tipo: string;
  status: string;
  agendadoPara: Date;
  legenda: string;
  permalink: string | null;
  /** Campanhas de DM presas a este post ("agendado:<id>"); vazio = sem campanha. */
  campanhas: { nome: string; ativa: boolean }[];
};

export type ItemHoje = { texto: string; href: string; nivel: "erro" | "normal" };

export type Hoje = {
  saiHoje: Bloco<PostDeHoje[]>;
  erros: Bloco<ItemHoje[]>;
  esperando: Bloco<ItemHoje[]>;
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

const ROTULO_STATUS: Record<string, string> = {
  RASCUNHO: "Rascunho",
  APROVADO: "Agendado",
  PUBLICANDO: "Publicando",
  PUBLICADO: "Publicado",
  ERRO: "Erro",
};

export function rotuloStatusPost(status: string): string {
  return ROTULO_STATUS[status] ?? status;
}

export function tomDoStatus(status: string): "neutral" | "success" | "error" {
  if (status === "PUBLICADO") return "success";
  if (status === "ERRO") return "error";
  return "neutral";
}

export function rotuloTipoPost(tipo: string): string {
  return tipo === "REEL" ? "Reel" : tipo === "CARROSSEL" ? "Carrossel" : "Post";
}

/** Junta os posts de hoje com as campanhas que apontam para eles (postUrl = "agendado:<id>"), em ordem de horário. */
export function montarSaiHoje(
  posts: { id: string; tipo: string; status: string; agendadoPara: Date; legenda: string | null; permalink: string | null }[],
  campanhas: { name: string; isActive: boolean; postUrl: string | null }[],
): PostDeHoje[] {
  const porPost = new Map<string, { nome: string; ativa: boolean }[]>();
  for (const c of campanhas) {
    const id = alvoAgendado(c.postUrl);
    if (!id) continue;
    porPost.set(id, [...(porPost.get(id) ?? []), { nome: c.name, ativa: c.isActive }]);
  }
  return [...posts]
    .sort((a, b) => a.agendadoPara.getTime() - b.agendadoPara.getTime())
    .map((p) => ({
      id: p.id,
      tipo: p.tipo,
      status: p.status,
      agendadoPara: p.agendadoPara,
      legenda: truncar(p.legenda ?? "", 80),
      permalink: p.permalink,
      campanhas: porPost.get(p.id) ?? [],
    }));
}

const ROTULO_FONTE: Record<string, string> = {
  WORKER: "no envio de DMs",
  TOKEN_REFRESH: "na renovação do token do Instagram",
  HEALTH: "na checagem de saúde",
  SYSTEM: "no sistema",
};

/** Erros das últimas 24 h, cada um com o link da tela que resolve. */
export function montarErros24h(x: {
  postsComErro: { tipo: string; erro: string | null }[];
  dmsFalhas: number;
  eventosPorFonte: { source: string; total: number }[];
}): ItemHoje[] {
  const itens: ItemHoje[] = [];
  for (const p of x.postsComErro) {
    itens.push({
      texto: `${rotuloTipoPost(p.tipo)} não publicado: ${truncar(p.erro ?? "erro sem mensagem", 110)}`,
      href: LINKS.calendario,
      nivel: "erro",
    });
  }
  if (x.dmsFalhas > 0) {
    itens.push({ texto: `${plural(x.dmsFalhas, "DM falhou", "DMs falharam")} no envio`, href: LINKS.registroDms, nivel: "erro" });
  }
  for (const e of x.eventosPorFonte) {
    if (e.total <= 0) continue;
    itens.push({
      texto: `${plural(e.total, "erro registrado", "erros registrados")} ${ROTULO_FONTE[e.source] ?? "no sistema"}`,
      href: LINK_DIAGNOSTICO,
      nivel: "erro",
    });
  }
  return itens;
}

/** O que só anda com o Luan: rascunhos no calendário e DMs seguradas para revisão. */
export function montarEsperando(x: { rascunhos: number; dmsSeguradas: number }): ItemHoje[] {
  const itens: ItemHoje[] = [];
  if (x.rascunhos > 0) {
    itens.push({
      texto: `${plural(x.rascunhos, "rascunho", "rascunhos")} no calendário aguardando sua aprovação`,
      href: LINKS.calendario,
      nivel: "normal",
    });
  }
  if (x.dmsSeguradas > 0) {
    itens.push({
      texto: `${plural(x.dmsSeguradas, "DM segurada", "DMs seguradas")} para revisão`,
      href: LINKS.palavras,
      nivel: "normal",
    });
  }
  return itens;
}

export async function carregarHoje(db: DbHoje, workspaceId: string, agora: Date = new Date()): Promise<Hoje> {
  const j = janelas(agora);
  const fimHoje = new Date(j.inicioHoje.getTime() + DIA_MS);
  const desde24h = new Date(agora.getTime() - DIA_MS);

  const [saiHoje, postsComErro, dmsFalhas, eventos, rascunhos, dmsSeguradas] = await Promise.all([
    bloco(async () => {
      const posts = await db.postAgendado.findMany({
        where: { workspaceId, agendadoPara: { gte: j.inicioHoje, lt: fimHoje } },
        orderBy: { agendadoPara: "asc" },
        select: { id: true, tipo: true, status: true, agendadoPara: true, legenda: true, permalink: true },
        take: 50,
      });
      if (posts.length === 0) return [];
      // Campanha que não carrega não esconde o post: ele aparece sem a etiqueta de campanha.
      const campanhas = await bloco(() =>
        db.automation.findMany({
          where: { workspaceId, postUrl: { in: posts.map((p) => PREFIXO_ALVO + p.id) } },
          select: { name: true, isActive: true, postUrl: true },
        }),
      );
      return montarSaiHoje(
        posts.map((p) => ({ ...p, tipo: String(p.tipo), status: String(p.status) })),
        campanhas.ok ? campanhas.dados : [],
      );
    }),
    bloco(() =>
      db.postAgendado.findMany({
        where: { workspaceId, status: "ERRO", updatedAt: { gte: desde24h } },
        orderBy: { updatedAt: "desc" },
        select: { tipo: true, erro: true },
        take: 10,
      }),
    ),
    bloco(() => db.dmLog.count({ where: { workspaceId, status: "FAILED", createdAt: { gte: desde24h } } })),
    bloco(() =>
      db.operationalEvent.groupBy({
        by: ["source"],
        where: { level: "ERROR", createdAt: { gte: desde24h }, OR: [{ workspaceId }, { workspaceId: null }] },
        _count: { _all: true },
      }),
    ),
    bloco(() => db.postAgendado.count({ where: { workspaceId, status: "RASCUNHO", agendadoPara: { gte: j.inicioHoje } } })),
    bloco(() => db.dmLog.count({ where: { workspaceId, status: "HELD_FOR_REVIEW" } })),
  ]);

  // Uma consulta que falha não apaga as outras: o bloco só fica indisponível se TODAS as dele falharem.
  const erros: Bloco<ItemHoje[]> =
    !postsComErro.ok && !dmsFalhas.ok && !eventos.ok
      ? { ok: false, motivo: postsComErro.motivo }
      : {
          ok: true,
          dados: montarErros24h({
            postsComErro: postsComErro.ok ? postsComErro.dados.map((p) => ({ tipo: String(p.tipo), erro: p.erro })) : [],
            dmsFalhas: dmsFalhas.ok ? dmsFalhas.dados : 0,
            eventosPorFonte: eventos.ok ? eventos.dados.map((e) => ({ source: String(e.source), total: e._count._all })) : [],
          }),
        };

  const esperando: Bloco<ItemHoje[]> =
    !rascunhos.ok && !dmsSeguradas.ok
      ? { ok: false, motivo: rascunhos.motivo }
      : {
          ok: true,
          dados: montarEsperando({
            rascunhos: rascunhos.ok ? rascunhos.dados : 0,
            dmsSeguradas: dmsSeguradas.ok ? dmsSeguradas.dados : 0,
          }),
        };

  return { saiHoje, erros, esperando };
}
