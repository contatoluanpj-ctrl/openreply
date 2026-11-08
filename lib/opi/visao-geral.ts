// Visão geral do OPI Central (/dashboard/visao-geral): junta, por workspace, seguidores, posts da semana, DMs,
// campanhas pausadas, caixa do mês e pedidos aos agentes, e monta a lista de pendências com link para a página
// que resolve cada uma. Só leitura. Cada bloco falha sozinho: se uma tabela nova ainda não existe no banco
// (migration do OPI Central não aplicada, Prisma P2021) o bloco mostra "tabela ainda não criada" e o resto segue.
import type { PrismaClient } from "@/app/generated/prisma/client";
import { freioPuxado } from "@/lib/opi/freio";

export const AVISO_OBRIGATORIO = "Conteúdo educativo. Não é recomendação individual de investimento.";

export const LINKS = {
  campanhas: "/campaigns",
  calendario: "/dashboard/calendario",
  agentes: "/dashboard/agentes",
  redes: "/dashboard/redes",
  financeiro: "/dashboard/financeiro",
  registroDms: "/logs",
  // DMs seguradas (HELD_FOR_REVIEW) aparecem em Palavras-chave > Comentários sem DM, com Reprocessar.
  palavras: "/dashboard/palavras",
} as const;

export type DbVisao = Pick<
  PrismaClient,
  | "redeSnapshot"
  | "followerSnapshot"
  | "instagramAccount"
  | "postAgendado"
  | "dmLog"
  | "automation"
  | "lancamento"
  | "pedidoAgente"
  | "operationalEvent"
>;

// ---------------------------------------------------------------------------------------------------------------
// Janelas de tempo (America/Sao_Paulo, UTC-3 fixo: o Brasil não tem horário de verão desde 2019).

const OFFSET_SP_MS = 3 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

export type Janelas = {
  agora: Date;
  inicioHoje: Date;
  inicio7Dias: Date; // hoje + 6 dias anteriores, inteiros
  inicioSemana: Date; // segunda-feira 00:00 em SP
  fimSemana: Date; // segunda seguinte 00:00 (exclusivo)
  inicioMes: Date;
  fimMes: Date; // dia 1 do mês seguinte (exclusivo)
};

export function janelas(agora: Date): Janelas {
  const local = new Date(agora.getTime() - OFFSET_SP_MS); // campos UTC = relógio de SP
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const meiaNoite = (ano: number, mes: number, dia: number) => new Date(Date.UTC(ano, mes, dia) + OFFSET_SP_MS);
  const inicioHoje = meiaNoite(y, m, d);
  const diasDesdeSegunda = (local.getUTCDay() + 6) % 7; // 0 = segunda
  const inicioSemana = new Date(inicioHoje.getTime() - diasDesdeSegunda * DIA_MS);
  return {
    agora,
    inicioHoje,
    inicio7Dias: new Date(inicioHoje.getTime() - 6 * DIA_MS),
    inicioSemana,
    fimSemana: new Date(inicioSemana.getTime() + 7 * DIA_MS),
    inicioMes: meiaNoite(y, m, 1),
    fimMes: meiaNoite(y, m + 1, 1),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Blocos que falham sozinhos

export type Bloco<T> = { ok: true; dados: T } | { ok: false; motivo: "sem_tabela" | "erro" };

export function tabelaInexistente(e: unknown): boolean {
  const err = e as { code?: unknown; message?: unknown } | null;
  if (err?.code === "P2021") return true;
  const msg = typeof err?.message === "string" ? err.message : "";
  return /relation .* does not exist|table .* does not exist/i.test(msg);
}

export async function bloco<T>(fn: () => Promise<T>): Promise<Bloco<T>> {
  try {
    return { ok: true, dados: await fn() };
  } catch (e) {
    if (tabelaInexistente(e)) return { ok: false, motivo: "sem_tabela" };
    console.error("[opi/visao-geral] bloco falhou:", e instanceof Error ? e.message : e);
    return { ok: false, motivo: "erro" };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Conversões defensivas

export function paraNumero(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "bigint") return Number(v);
  if (v && typeof v === "object" && "toNumber" in v && typeof (v as { toNumber: unknown }).toNumber === "function") {
    const n = (v as { toNumber: () => number }).toNumber();
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === "string" || (v && typeof v === "object")) {
    const n = Number(String(v));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** Lê o total de seguidores de RedeSnapshot.metricas sem confiar no formato (cada coletor grava o seu). */
export function seguidoresDasMetricas(metricas: unknown): number | null {
  if (!metricas || typeof metricas !== "object" || Array.isArray(metricas)) return null;
  const m = metricas as Record<string, unknown>;
  for (const chave of ["seguidores", "followers", "followersCount", "followers_count", "inscritos", "subscribers"]) {
    const v = m[chave];
    if (v === null || v === undefined || v === "") continue;
    const n = typeof v === "number" ? v : Number(String(v));
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function estadoComProblema(estado: string): boolean {
  return /erro|error|descon|disconnect|expir|falh|fail|revog|invalid/i.test(estado);
}

export function temAvisoObrigatorio(legenda: string): boolean {
  return legenda.includes(AVISO_OBRIGATORIO);
}

// ---------------------------------------------------------------------------------------------------------------
// Dados

export type RedeResumo = {
  rede: string;
  seguidores: number | null;
  estado: string;
  coletadoEm: Date;
  fonte: "rede" | "instagram";
};

export type PostsResumo = {
  publicados: number;
  agendados: number; // APROVADO ou PUBLICANDO na semana
  rascunhos: number; // aguardando aprovação do Luan
  erros: number;
  semAviso: number; // posts ainda não publicados (daqui para frente) sem o aviso obrigatório na legenda
};

export type DmsResumo = { hoje: number; seteDias: number; emRevisao: number };

export type CampanhasResumo = {
  pausadas: { id: string; name: string }[];
  totalPausadas: number;
  freioPuxado: boolean;
};

export type CaixaResumo = {
  despesasPagas: number;
  despesasPrevistas: number;
  receitasPagas: number;
  receitasPrevistas: number;
  lancamentosNoMes: number;
  vencidos: number; // PREVISTO com data antes de hoje (qualquer mês)
};

export type AgentesResumo = {
  emAndamento: { id: string; agente: string; mensagem: string; status: string; createdAt: Date }[];
  totalEmAndamento: number;
  errosRecentes: number; // últimos 7 dias
};

export type VisaoGeral = {
  janelas: Janelas;
  redes: Bloco<RedeResumo[]>;
  posts: Bloco<PostsResumo>;
  dms: Bloco<DmsResumo>;
  campanhas: Bloco<CampanhasResumo>;
  caixa: Bloco<CaixaResumo>;
  agentes: Bloco<AgentesResumo>;
};

const LIMITE_LISTA = 5;

export function truncar(texto: string, max = 90): string {
  const t = texto.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

async function carregarRedes(db: DbVisao, workspaceId: string): Promise<RedeResumo[]> {
  // RedeSnapshot pode não existir ainda (migration pendente); o Instagram tem fallback no FollowerSnapshot antigo.
  let snapshots: { rede: string; estado: string; metricas: unknown; coletadoEm: Date }[] = [];
  let erroRede: unknown = null;
  try {
    snapshots = await db.redeSnapshot.findMany({
      where: { workspaceId },
      orderBy: [{ rede: "asc" }, { coletadoEm: "desc" }],
      distinct: ["rede"],
      select: { rede: true, estado: true, metricas: true, coletadoEm: true },
    });
  } catch (e) {
    if (!tabelaInexistente(e)) throw e;
    erroRede = e;
  }

  const redes: RedeResumo[] = snapshots.map((s) => ({
    rede: s.rede,
    seguidores: seguidoresDasMetricas(s.metricas),
    estado: s.estado,
    coletadoEm: s.coletadoEm,
    fonte: "rede",
  }));

  const temInstagram = redes.some((r) => r.rede.toLowerCase() === "instagram" && r.seguidores !== null);
  if (!temInstagram) {
    const contas = await db.instagramAccount.findMany({
      where: { workspaceId },
      select: {
        username: true,
        followerSnapshots: { orderBy: { date: "desc" }, take: 1, select: { followersCount: true, date: true } },
      },
    });
    for (const c of contas) {
      const ultimo = c.followerSnapshots[0];
      if (!ultimo) continue;
      redes.push({
        rede: contas.length > 1 ? `instagram @${c.username}` : "instagram",
        seguidores: ultimo.followersCount,
        estado: "ok",
        coletadoEm: ultimo.date,
        fonte: "instagram",
      });
    }
    // Sem RedeSnapshot e sem nada do Instagram: deixa o bloco dizer que a tabela não existe.
    if (erroRede && redes.length === 0) throw erroRede;
  }
  return redes;
}

async function carregarPosts(db: DbVisao, workspaceId: string, j: Janelas): Promise<PostsResumo> {
  const [semana, futuros] = await Promise.all([
    db.postAgendado.findMany({
      where: { workspaceId, agendadoPara: { gte: j.inicioSemana, lt: j.fimSemana } },
      select: { status: true },
    }),
    db.postAgendado.findMany({
      where: { workspaceId, agendadoPara: { gte: j.agora }, status: { in: ["RASCUNHO", "APROVADO", "PUBLICANDO"] } },
      select: { legenda: true },
      take: 500,
    }),
  ]);
  const conta = (...st: string[]) => semana.filter((p) => st.includes(p.status)).length;
  return {
    publicados: conta("PUBLICADO"),
    agendados: conta("APROVADO", "PUBLICANDO"),
    rascunhos: conta("RASCUNHO"),
    erros: conta("ERRO"),
    semAviso: futuros.filter((p) => !temAvisoObrigatorio(p.legenda ?? "")).length,
  };
}

async function carregarDms(db: DbVisao, workspaceId: string, j: Janelas): Promise<DmsResumo> {
  const [hoje, seteDias, emRevisao] = await Promise.all([
    db.dmLog.count({ where: { workspaceId, status: "SENT", dmSentAt: { gte: j.inicioHoje } } }),
    db.dmLog.count({ where: { workspaceId, status: "SENT", dmSentAt: { gte: j.inicio7Dias } } }),
    db.dmLog.count({ where: { workspaceId, status: "HELD_FOR_REVIEW" } }),
  ]);
  return { hoje, seteDias, emRevisao };
}

async function carregarCampanhas(db: DbVisao, workspaceId: string): Promise<CampanhasResumo> {
  const [pausadas, totalPausadas, freio] = await Promise.all([
    db.automation.findMany({
      where: { workspaceId, isActive: false },
      orderBy: { updatedAt: "desc" },
      take: LIMITE_LISTA,
      select: { id: true, name: true },
    }),
    db.automation.count({ where: { workspaceId, isActive: false } }),
    freioPuxado(db, workspaceId),
  ]);
  return { pausadas, totalPausadas, freioPuxado: freio };
}

async function carregarCaixa(db: DbVisao, workspaceId: string, j: Janelas): Promise<CaixaResumo> {
  const [doMes, vencidos] = await Promise.all([
    db.lancamento.findMany({
      where: { workspaceId, data: { gte: j.inicioMes, lt: j.fimMes } },
      select: { tipo: true, status: true, valor: true },
    }),
    db.lancamento.count({ where: { workspaceId, status: "PREVISTO", data: { lt: j.inicioHoje } } }),
  ]);
  const soma = (tipo: string, status: string) =>
    Math.round(
      doMes.filter((l) => l.tipo === tipo && l.status === status).reduce((t, l) => t + paraNumero(l.valor), 0) * 100,
    ) / 100;
  return {
    despesasPagas: soma("DESPESA", "PAGO"),
    despesasPrevistas: soma("DESPESA", "PREVISTO"),
    receitasPagas: soma("RECEITA", "PAGO"),
    receitasPrevistas: soma("RECEITA", "PREVISTO"),
    lancamentosNoMes: doMes.length,
    vencidos,
  };
}

async function carregarAgentes(db: DbVisao, workspaceId: string, j: Janelas): Promise<AgentesResumo> {
  const abertos = { workspaceId, status: { in: ["NOVO" as const, "EM_ANDAMENTO" as const] } };
  const [lista, total, erros] = await Promise.all([
    db.pedidoAgente.findMany({
      where: abertos,
      orderBy: { createdAt: "desc" },
      take: LIMITE_LISTA,
      select: { id: true, agente: true, mensagem: true, status: true, createdAt: true },
    }),
    db.pedidoAgente.count({ where: abertos }),
    db.pedidoAgente.count({ where: { workspaceId, status: "ERRO", updatedAt: { gte: j.inicio7Dias } } }),
  ]);
  return {
    emAndamento: lista.map((p) => ({ ...p, mensagem: truncar(p.mensagem) })),
    totalEmAndamento: total,
    errosRecentes: erros,
  };
}

export async function carregarVisaoGeral(db: DbVisao, workspaceId: string, agora: Date = new Date()): Promise<VisaoGeral> {
  const j = janelas(agora);
  const [redes, posts, dms, campanhas, caixa, agentes] = await Promise.all([
    bloco(() => carregarRedes(db, workspaceId)),
    bloco(() => carregarPosts(db, workspaceId, j)),
    bloco(() => carregarDms(db, workspaceId, j)),
    bloco(() => carregarCampanhas(db, workspaceId)),
    bloco(() => carregarCaixa(db, workspaceId, j)),
    bloco(() => carregarAgentes(db, workspaceId, j)),
  ]);
  return { janelas: j, redes, posts, dms, campanhas, caixa, agentes };
}

// ---------------------------------------------------------------------------------------------------------------
// Pendências

export type Pendencia = { texto: string; href: string; nivel: "erro" | "normal" };

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

export function montarPendencias(v: Pick<VisaoGeral, "redes" | "posts" | "dms" | "campanhas" | "caixa" | "agentes">): Pendencia[] {
  const p: Pendencia[] = [];

  if (v.campanhas.ok && v.campanhas.dados.freioPuxado) {
    p.push({ texto: "Freio da DM puxado: nenhuma DM automática está saindo", href: LINKS.campanhas, nivel: "erro" });
  }
  if (v.dms.ok && v.dms.dados.emRevisao > 0) {
    const n = v.dms.dados.emRevisao;
    p.push({ texto: `${plural(n, "DM segurada", "DMs seguradas")} para revisão`, href: LINKS.palavras, nivel: "erro" });
  }
  if (v.campanhas.ok && v.campanhas.dados.totalPausadas > 0) {
    const n = v.campanhas.dados.totalPausadas;
    p.push({ texto: `${plural(n, "campanha pausada", "campanhas pausadas")} aguardando revisão`, href: LINKS.campanhas, nivel: "normal" });
  }
  if (v.posts.ok) {
    const d = v.posts.dados;
    if (d.erros > 0) {
      p.push({ texto: `${plural(d.erros, "post", "posts")} da semana com erro na publicação`, href: LINKS.calendario, nivel: "erro" });
    }
    if (d.semAviso > 0) {
      p.push({ texto: `${plural(d.semAviso, "legenda", "legendas")} sem o aviso obrigatório`, href: LINKS.calendario, nivel: "erro" });
    }
    if (d.rascunhos > 0) {
      p.push({ texto: `${plural(d.rascunhos, "post", "posts")} da semana aguardando sua aprovação`, href: LINKS.calendario, nivel: "normal" });
    }
  }
  if (v.agentes.ok && v.agentes.dados.errosRecentes > 0) {
    const n = v.agentes.dados.errosRecentes;
    p.push({ texto: `${plural(n, "pedido", "pedidos")} aos agentes com erro (7 dias)`, href: LINKS.agentes, nivel: "erro" });
  }
  if (v.redes.ok) {
    for (const r of v.redes.dados.filter((x) => estadoComProblema(x.estado))) {
      p.push({ texto: `Rede ${r.rede}: ${r.estado}`, href: LINKS.redes, nivel: "erro" });
    }
  }
  if (v.caixa.ok && v.caixa.dados.vencidos > 0) {
    const n = v.caixa.dados.vencidos;
    p.push({ texto: `${plural(n, "lançamento previsto vencido", "lançamentos previstos vencidos")}`, href: LINKS.financeiro, nivel: "normal" });
  }

  // Erros primeiro, mantendo a ordem acima dentro de cada nível.
  return [...p.filter((x) => x.nivel === "erro"), ...p.filter((x) => x.nivel === "normal")];
}

// ---------------------------------------------------------------------------------------------------------------
// Formatação pt-BR

const fmtNumero = new Intl.NumberFormat("pt-BR");
const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtData = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export const formatarNumero = (n: number) => fmtNumero.format(n);
export const formatarBRL = (n: number) => fmtBRL.format(n);
export const formatarDataHora = (d: Date) => fmtData.format(d);
