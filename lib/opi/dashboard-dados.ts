// Dashboard principal do OPI Central (/dashboard): agrega seguidores, DMs, palavras, horários, posts e gasto
// para ajudar o Luan a decidir (o que postar mais, se a DM converte, onde está o gasto). Só leitura e só dados
// do banco: nada é inventado; onde não há dado, a série fica vazia e a tela explica de onde ele virá.
// As funções de agregação são puras (testadas em __tests__/opi-dashboard-dados.test.ts); carregarDashboard
// só busca as linhas e chama as funções. Dias e horas sempre em America/Sao_Paulo (UTC-3 fixo, sem horário de verão).
import type { PrismaClient } from "@/app/generated/prisma/client";
import { REDES, rotuloMetrica, type RedeId } from "@/lib/opi/redes";
import { bloco, janelas, paraNumero, seguidoresDasMetricas, type Bloco } from "@/lib/opi/visao-geral";

export const PERIODOS = [7, 30, 90] as const;
export type Periodo = (typeof PERIODOS)[number];
export type PorPeriodo<T> = Record<Periodo, T>;

const OFFSET_SP_MS = 3 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------------------------------------------
// Tempo

/** "AAAA-MM-DD" do dia em São Paulo. */
export function chaveDiaSP(d: Date): string {
  return new Date(d.getTime() - OFFSET_SP_MS).toISOString().slice(0, 10);
}

/** Hora do dia (0–23) em São Paulo. */
export function horaSP(d: Date): number {
  return new Date(d.getTime() - OFFSET_SP_MS).getUTCHours();
}

/** Os últimos `n` dias de São Paulo terminando hoje, em ordem crescente. */
export function ultimosDias(agora: Date, n: number): string[] {
  const hoje = chaveDiaSP(agora);
  const base = Date.parse(`${hoje}T00:00:00Z`);
  return Array.from({ length: n }, (_, i) => new Date(base - (n - 1 - i) * DIA_MS).toISOString().slice(0, 10));
}

/** "dd/mm" a partir de "AAAA-MM-DD". */
export function rotuloDia(chave: string): string {
  return `${chave.slice(8, 10)}/${chave.slice(5, 7)}`;
}

/** Início (00:00 em SP) do primeiro dia de uma janela de `n` dias terminando hoje. */
export function inicioJanela(agora: Date, n: number): Date {
  return new Date(Date.parse(`${ultimosDias(agora, n)[0]}T00:00:00Z`) + OFFSET_SP_MS);
}

/** Variação percentual (1 casa). Sem base comparável (anterior <= 0) devolve null: a tela não mostra delta. */
export function variacaoPct(atual: number, anterior: number | null | undefined): number | null {
  if (anterior === null || anterior === undefined || !Number.isFinite(anterior) || anterior <= 0) return null;
  return Math.round(((atual - anterior) / anterior) * 1000) / 10;
}

// ---------------------------------------------------------------------------------------------------------------
// Seguidores (FollowerSnapshot do Instagram)

export type PontoSeguidores = { instagramAccountId: string; date: Date; followersCount: number };
export type DiaSeguidores = { dia: string; rotulo: string; seguidores: number | null };

/**
 * Soma das contas por dia. FollowerSnapshot.date é a meia-noite UTC do dia a que o número pertence, então a chave
 * é a data UTC. Dia sem coleta repete o último número conhecido daquela conta; antes da 1ª coleta a conta não entra.
 */
export function serieSeguidores(pontos: PontoSeguidores[], dias: string[]): DiaSeguidores[] {
  const porConta = new Map<string, { dia: string; v: number }[]>();
  for (const p of pontos) {
    const lista = porConta.get(p.instagramAccountId) ?? [];
    lista.push({ dia: p.date.toISOString().slice(0, 10), v: p.followersCount });
    porConta.set(p.instagramAccountId, lista);
  }
  for (const lista of porConta.values()) lista.sort((a, b) => a.dia.localeCompare(b.dia));

  return dias.map((dia) => {
    let soma = 0;
    let algum = false;
    for (const lista of porConta.values()) {
      let ultimo: number | null = null;
      for (const p of lista) {
        if (p.dia > dia) break;
        ultimo = p.v;
      }
      if (ultimo !== null) {
        soma += ultimo;
        algum = true;
      }
    }
    return { dia, rotulo: rotuloDia(dia), seguidores: algum ? soma : null };
  });
}

/** Último valor e valor de 7 dias antes numa série diária (para o delta 7d). */
export function ultimoEAnterior(serie: DiaSeguidores[], distancia = 7): { atual: number | null; anterior: number | null } {
  const i = serie.map((d) => d.seguidores !== null).lastIndexOf(true);
  if (i < 0) return { atual: null, anterior: null };
  const j = i - distancia;
  return { atual: serie[i].seguidores, anterior: j >= 0 ? serie[j].seguidores : null };
}

// ---------------------------------------------------------------------------------------------------------------
// DMs (DmLog)

export type LogDm = {
  createdAt: Date;
  dmSentAt: Date | null;
  status: string;
  matchedKeyword: string | null;
  campanha: string;
};

/** Comentários que bateram com uma campanha: tudo menos SKIPPED_NO_MATCH (comentário sem palavra). */
export function ehComentarioDeCampanha(l: Pick<LogDm, "status">): boolean {
  return l.status !== "SKIPPED_NO_MATCH";
}

export function logsDesde<T extends { createdAt: Date }>(logs: T[], inicio: Date): T[] {
  return logs.filter((l) => l.createdAt.getTime() >= inicio.getTime());
}

export type DiaDms = { dia: string; rotulo: string; enviadas: number; seguradas: number; falhas: number };

/** DMs por dia do comentário: enviadas (SENT), seguradas para revisão (HELD_FOR_REVIEW) e falhas (FAILED). */
export function dmsPorDia(logs: LogDm[], dias: string[]): DiaDms[] {
  const mapa = new Map<string, DiaDms>(dias.map((d) => [d, { dia: d, rotulo: rotuloDia(d), enviadas: 0, seguradas: 0, falhas: 0 }]));
  for (const l of logs) {
    const linha = mapa.get(chaveDiaSP(l.createdAt));
    if (!linha) continue;
    if (l.status === "SENT") linha.enviadas++;
    else if (l.status === "HELD_FOR_REVIEW") linha.seguradas++;
    else if (l.status === "FAILED") linha.falhas++;
  }
  return dias.map((d) => mapa.get(d)!);
}

export type Conversao = { comentarios: number; enviadas: number; taxa: number | null };

/** Taxa comentário→DM: DMs enviadas / comentários de campanha (em %, 1 casa). */
export function taxaConversao(logs: Pick<LogDm, "status">[]): Conversao {
  const doCampanha = logs.filter(ehComentarioDeCampanha);
  const enviadas = doCampanha.filter((l) => l.status === "SENT").length;
  const comentarios = doCampanha.length;
  return { comentarios, enviadas, taxa: comentarios > 0 ? Math.round((enviadas / comentarios) * 1000) / 10 : null };
}

export type PalavraConversao = { palavra: string; comentarios: number; enviadas: number; taxa: number | null };

/** Comentários x DMs enviadas por palavra (ou pelo nome da campanha quando o log não guardou a palavra). */
export function conversaoPorPalavra(logs: LogDm[], limite = 8): PalavraConversao[] {
  const mapa = new Map<string, { comentarios: number; enviadas: number }>();
  for (const l of logs) {
    if (!ehComentarioDeCampanha(l)) continue;
    const chave = (l.matchedKeyword?.trim() || l.campanha.trim() || "Sem palavra").toUpperCase();
    const atual = mapa.get(chave) ?? { comentarios: 0, enviadas: 0 };
    atual.comentarios++;
    if (l.status === "SENT") atual.enviadas++;
    mapa.set(chave, atual);
  }
  return [...mapa.entries()]
    .map(([palavra, v]) => ({
      palavra,
      ...v,
      taxa: v.comentarios > 0 ? Math.round((v.enviadas / v.comentarios) * 1000) / 10 : null,
    }))
    .sort((a, b) => b.comentarios - a.comentarios || b.enviadas - a.enviadas || a.palavra.localeCompare(b.palavra))
    .slice(0, limite);
}

export type HoraComentarios = { hora: number; rotulo: string; comentarios: number };

/** Comentários por hora do dia em São Paulo (todos os comentários recebidos, com ou sem palavra). */
export function horarioComentarios(logs: Pick<LogDm, "createdAt">[]): HoraComentarios[] {
  const contagem = new Array<number>(24).fill(0);
  for (const l of logs) contagem[horaSP(l.createdAt)]++;
  return contagem.map((comentarios, hora) => ({ hora, rotulo: `${String(hora).padStart(2, "0")}h`, comentarios }));
}

/** As horas com mais comentários (para a frase "o que olhar"). Vazio quando não há comentários. */
export function horasDePico(horas: HoraComentarios[], n = 2): number[] {
  return horas
    .filter((h) => h.comentarios > 0)
    .sort((a, b) => b.comentarios - a.comentarios || a.hora - b.hora)
    .slice(0, n)
    .map((h) => h.hora);
}

/** DMs enviadas (pelo dmSentAt) dentro de [inicio, fim). */
export function contarEnviadas(logs: LogDm[], inicio: Date, fim: Date): number {
  return logs.filter((l) => l.status === "SENT" && l.dmSentAt && l.dmSentAt >= inicio && l.dmSentAt < fim).length;
}

// ---------------------------------------------------------------------------------------------------------------
// Redes (RedeSnapshot + Instagram)

export type SnapRede = { rede: string; estado: string; metricas: unknown; coletadoEm: Date };

export type FatiaAudiencia = { rede: string; nome: string; seguidores: number; pct: number };

/** Seguidores por rede com participação (%), maior primeiro; redes sem número ficam de fora. */
export function distribuicaoAudiencia(redes: { rede: string; nome: string; seguidores: number | null }[]): FatiaAudiencia[] {
  const com = redes.filter((r): r is { rede: string; nome: string; seguidores: number } => (r.seguidores ?? 0) > 0);
  const total = com.reduce((t, r) => t + r.seguidores, 0);
  return com
    .map((r) => ({ ...r, pct: total > 0 ? Math.round((r.seguidores / total) * 1000) / 10 : 0 }))
    .sort((a, b) => b.seguidores - a.seguidores);
}

export type StatPlataforma = { rotulo: string; valor: number; formato: "numero" | "brl" | "pct"; delta: number | null };

export type CardPlataforma = {
  rede: RedeId;
  nome: string;
  estado: string;
  coletadoEm: Date | null;
  destaque: StatPlataforma;
  stats: StatPlataforma[];
};

const CHAVES_SEGUIDORES = new Set(["seguidores", "followers", "followersCount", "followers_count", "inscritos", "subscribers"]);

function numeros(metricas: unknown): [string, number][] {
  if (!metricas || typeof metricas !== "object" || Array.isArray(metricas)) return [];
  const out: [string, number][] = [];
  for (const [k, v] of Object.entries(metricas as Record<string, unknown>)) {
    if (v === null || v === undefined || v === "") continue;
    const n = typeof v === "number" ? v : Number(String(v));
    if (Number.isFinite(n)) out.push([k, n]);
  }
  return out;
}

/** Rótulo legível: "visualizacoes_7d" → "Visualizações 7d", "gasto_mes" → "Gasto do mês". */
export function rotuloStat(chave: string): string {
  const m = /^(.*?)_(7d|30d|90d|mes)$/.exec(chave);
  if (!m) return rotuloMetrica(chave);
  const base = rotuloMetrica(m[1]);
  return m[2] === "mes" ? `${base} do mês` : `${base} ${m[2]}`;
}

function formatoDaChave(chave: string): StatPlataforma["formato"] {
  if (/^(gasto|custo|investimento|cpc|cpm)/i.test(chave)) return "brl";
  if (/(ctr|taxa|_pct$)/i.test(chave)) return "pct";
  return "numero";
}

/** Snapshot de referência para o delta: o mais recente coletado ao menos 7 dias antes do último. */
function referencia(snaps: SnapRede[], ultimo: SnapRede): SnapRede | null {
  const limite = ultimo.coletadoEm.getTime() - 7 * DIA_MS;
  let ref: SnapRede | null = null;
  for (const s of snaps) {
    const t = s.coletadoEm.getTime();
    if (t <= limite && (!ref || t > ref.coletadoEm.getTime())) ref = s;
  }
  return ref;
}

export type ExtrasInstagram = {
  serie: DiaSeguidores[];
  coletadoEm: Date | null;
  stats: StatPlataforma[];
};

/**
 * Um card por rede com dados (snapshot com algum número, ou o Instagram pelo FollowerSnapshot). Destaque é o
 * número de seguidores/inscritos com delta 7d; sem seguidores (ex.: Ads) o destaque é a 1ª métrica numérica.
 * Até 4 estatísticas (2x2), cada uma com delta contra o snapshot de 7 dias antes, quando houver.
 */
export function cardsPlataforma(snaps: SnapRede[], instagram: ExtrasInstagram | null): CardPlataforma[] {
  const porRede = new Map<string, SnapRede[]>();
  for (const s of snaps) porRede.set(s.rede, [...(porRede.get(s.rede) ?? []), s]);

  const cards: CardPlataforma[] = [];
  for (const def of REDES) {
    const lista = porRede.get(def.id) ?? [];
    const ultimo = lista.reduce<SnapRede | null>((u, s) => (!u || s.coletadoEm > u.coletadoEm ? s : u), null);
    const ref = ultimo ? referencia(lista, ultimo) : null;
    const nums = ultimo ? numeros(ultimo.metricas) : [];
    const numsRef = new Map(ref ? numeros(ref.metricas) : []);
    const stat = (k: string, v: number): StatPlataforma => ({
      rotulo: rotuloStat(k),
      valor: v,
      formato: formatoDaChave(k),
      delta: variacaoPct(v, numsRef.get(k)),
    });

    if (def.id === "instagram" && instagram) {
      const { atual, anterior } = ultimoEAnterior(instagram.serie);
      if (atual !== null) {
        const outros = nums.filter(([k]) => !CHAVES_SEGUIDORES.has(k)).map(([k, v]) => stat(k, v));
        cards.push({
          rede: def.id,
          nome: def.nome,
          estado: "conectado",
          coletadoEm: instagram.coletadoEm ?? ultimo?.coletadoEm ?? null,
          destaque: { rotulo: "Seguidores", valor: atual, formato: "numero", delta: variacaoPct(atual, anterior) },
          stats: [...instagram.stats, ...outros].slice(0, 4),
        });
        continue;
      }
    }

    if (!ultimo || nums.length === 0) continue;
    const seg = seguidoresDasMetricas(ultimo.metricas);
    const chaveSeg = nums.find(([k]) => CHAVES_SEGUIDORES.has(k))?.[0];
    const destaque: StatPlataforma =
      seg !== null && chaveSeg
        ? {
            rotulo: chaveSeg === "inscritos" || chaveSeg === "subscribers" ? "Inscritos" : "Seguidores",
            valor: seg,
            formato: "numero",
            delta: variacaoPct(seg, ref ? seguidoresDasMetricas(ref.metricas) : null),
          }
        : stat(nums[0][0], nums[0][1]);
    const resto = nums.filter(([k]) => !CHAVES_SEGUIDORES.has(k) && rotuloStat(k) !== destaque.rotulo);
    cards.push({
      rede: def.id,
      nome: def.nome,
      estado: ultimo.estado,
      coletadoEm: ultimo.coletadoEm,
      destaque,
      stats: resto.slice(0, 4).map(([k, v]) => stat(k, v)),
    });
  }
  return cards;
}

/** Seguidores de cada rede (social) hoje e 7 dias antes, para o total com delta; Ads ficam de fora. */
export function totalSeguidores(snaps: SnapRede[], serieIg: DiaSeguidores[] | null): {
  atual: number | null;
  anterior: number | null;
  redes: { rede: string; nome: string; seguidores: number | null }[];
} {
  const redes: { rede: string; nome: string; seguidores: number | null }[] = [];
  let atual = 0;
  let anterior = 0;
  let algum = false;
  let comparavel = true;

  for (const def of REDES.filter((r) => r.tipo === "social")) {
    if (def.id === "instagram" && serieIg) {
      const ig = ultimoEAnterior(serieIg);
      if (ig.atual !== null) {
        redes.push({ rede: def.id, nome: def.nome, seguidores: ig.atual });
        atual += ig.atual;
        algum = true;
        if (ig.anterior !== null) anterior += ig.anterior;
        else comparavel = false;
        continue;
      }
    }
    const lista = snaps.filter((s) => s.rede === def.id);
    const ultimo = lista.reduce<SnapRede | null>((u, s) => (!u || s.coletadoEm > u.coletadoEm ? s : u), null);
    const v = ultimo ? seguidoresDasMetricas(ultimo.metricas) : null;
    if (v === null || !ultimo) continue;
    redes.push({ rede: def.id, nome: def.nome, seguidores: v });
    atual += v;
    algum = true;
    const ref = referencia(lista, ultimo);
    const vRef = ref ? seguidoresDasMetricas(ref.metricas) : null;
    if (vRef !== null) anterior += vRef;
    else comparavel = false;
  }
  return { atual: algum ? atual : null, anterior: algum && comparavel ? anterior : null, redes };
}

// ---------------------------------------------------------------------------------------------------------------
// Pendências: rótulo da área pelo link (como a coluna "área" do artefato)

const AREAS: [RegExp, string][] = [
  [/^\/campaigns/, "Campanhas"],
  [/^\/dashboard\/palavras/, "DMs"],
  [/^\/dashboard\/calendario/, "Calendário"],
  [/^\/dashboard\/agentes/, "Agentes"],
  [/^\/dashboard\/redes/, "Redes"],
  [/^\/dashboard\/financeiro/, "Financeiro"],
  [/^\/logs/, "DMs"],
];

export function areaDaPendencia(href: string): string {
  return AREAS.find(([re]) => re.test(href))?.[1] ?? "Geral";
}

// ---------------------------------------------------------------------------------------------------------------
// Carregamento (só leitura)

export type DbDashboard = Pick<PrismaClient, "followerSnapshot" | "redeSnapshot" | "dmLog" | "postAgendado" | "lancamento">;

export type KpiValor = { valor: number | null; anterior: number | null; delta: number | null };

export type Dashboard = {
  geradoEm: Date;
  kpis: {
    seguidores: Bloco<KpiValor & { redes: number }>;
    dms7d: Bloco<KpiValor>;
    taxa: Bloco<KpiValor & { comentarios: number; enviadas: number }>;
    posts: Bloco<KpiValor & { agendados: number }>;
    gasto: Bloco<KpiValor & { previsto: number }>;
  };
  plataformas: Bloco<CardPlataforma[]>;
  seguidores: Bloco<PorPeriodo<DiaSeguidores[]>>;
  dms: Bloco<PorPeriodo<DiaDms[]>>;
  palavras: Bloco<PorPeriodo<PalavraConversao[]>>;
  audiencia: Bloco<FatiaAudiencia[]>;
  horario: Bloco<PorPeriodo<HoraComentarios[]>>;
};

function porPeriodo<T>(f: (n: Periodo) => T): PorPeriodo<T> {
  return { 7: f(7), 30: f(30), 90: f(90) };
}

function mesAnterior(j: ReturnType<typeof janelas>): { inicio: Date; fim: Date } {
  const local = new Date(j.inicioMes.getTime() - OFFSET_SP_MS);
  const inicio = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - 1, 1) + OFFSET_SP_MS);
  return { inicio, fim: j.inicioMes };
}

export async function carregarDashboard(db: DbDashboard, workspaceId: string, agora: Date = new Date()): Promise<Dashboard> {
  const j = janelas(agora);
  const inicio90 = inicioJanela(agora, 90);
  // Para o delta da taxa (30d contra os 30d anteriores) precisa de 60 dias de log; 90 cobre.
  const dias = porPeriodo((n) => ultimosDias(agora, n));

  const [pontosIg, snaps, logs] = await Promise.all([
    bloco(async () =>
      db.followerSnapshot.findMany({
        where: { instagramAccount: { workspaceId }, date: { gte: new Date(inicio90.getTime() - 8 * DIA_MS) } },
        select: { instagramAccountId: true, date: true, followersCount: true },
        orderBy: { date: "asc" },
      }),
    ),
    bloco(async () =>
      db.redeSnapshot.findMany({
        where: { workspaceId, coletadoEm: { gte: new Date(agora.getTime() - 120 * DIA_MS) } },
        select: { rede: true, estado: true, metricas: true, coletadoEm: true },
        orderBy: { coletadoEm: "asc" },
        take: 5000,
      }),
    ),
    bloco(async () => {
      const linhas = await db.dmLog.findMany({
        where: { workspaceId, createdAt: { gte: inicio90 } },
        select: { createdAt: true, dmSentAt: true, status: true, matchedKeyword: true, automation: { select: { name: true } } },
        take: 50000,
      });
      return linhas.map(
        (l): LogDm => ({
          createdAt: l.createdAt,
          dmSentAt: l.dmSentAt,
          status: String(l.status),
          matchedKeyword: l.matchedKeyword,
          campanha: l.automation?.name ?? "",
        }),
      );
    }),
  ]);

  const mesAnt = mesAnterior(j);
  const [posts, gasto] = await Promise.all([
    bloco(async () => {
      const [mes, ant, agendados] = await Promise.all([
        db.postAgendado.count({ where: { workspaceId, status: "PUBLICADO", agendadoPara: { gte: j.inicioMes, lt: j.fimMes } } }),
        db.postAgendado.count({ where: { workspaceId, status: "PUBLICADO", agendadoPara: { gte: mesAnt.inicio, lt: mesAnt.fim } } }),
        db.postAgendado.count({
          where: { workspaceId, status: { in: ["APROVADO", "PUBLICANDO"] }, agendadoPara: { gte: agora, lt: j.fimMes } },
        }),
      ]);
      return { valor: mes, anterior: ant, delta: variacaoPct(mes, ant), agendados };
    }),
    bloco(async () => {
      const linhas = await db.lancamento.findMany({
        where: { workspaceId, tipo: "DESPESA", data: { gte: mesAnt.inicio, lt: j.fimMes } },
        select: { data: true, status: true, valor: true },
      });
      const soma = (f: (l: (typeof linhas)[number]) => boolean) =>
        Math.round(linhas.filter(f).reduce((t, l) => t + paraNumero(l.valor), 0) * 100) / 100;
      const pago = soma((l) => l.status === "PAGO" && l.data >= j.inicioMes);
      const ant = soma((l) => l.status === "PAGO" && l.data < j.inicioMes);
      const previsto = soma((l) => l.status === "PREVISTO" && l.data >= j.inicioMes);
      return { valor: pago, anterior: ant, delta: variacaoPct(pago, ant), previsto };
    }),
  ]);

  // Séries do Instagram (sem FollowerSnapshot a série é vazia, não inventada).
  const serieIgCompleta = pontosIg.ok ? serieSeguidores(pontosIg.dados, ultimosDias(agora, 97)) : null;
  const serie90 = serieIgCompleta ? serieIgCompleta.slice(7) : null;
  const coletaIg = pontosIg.ok && pontosIg.dados.length > 0 ? pontosIg.dados[pontosIg.dados.length - 1].date : null;

  const snapsLista = snaps.ok ? snaps.dados : [];
  const tot = totalSeguidores(snapsLista, serieIgCompleta);

  const seguidoresKpi: Dashboard["kpis"]["seguidores"] =
    !snaps.ok && !pontosIg.ok
      ? { ok: false, motivo: snaps.motivo }
      : { ok: true, dados: { valor: tot.atual, anterior: tot.anterior, delta: tot.atual !== null ? variacaoPct(tot.atual, tot.anterior) : null, redes: tot.redes.length } };

  const inicio7 = inicioJanela(agora, 7);
  const inicio14 = inicioJanela(agora, 14);
  const inicio30 = inicioJanela(agora, 30);
  const inicio60 = inicioJanela(agora, 60);

  const dms7d: Dashboard["kpis"]["dms7d"] = logs.ok
    ? (() => {
        const v = contarEnviadas(logs.dados, inicio7, new Date(agora.getTime() + 1));
        // dmSentAt pode ser de log criado antes da janela de 90d; para 7/14 dias a janela cobre.
        const a = contarEnviadas(logs.dados, inicio14, inicio7);
        return { ok: true as const, dados: { valor: v, anterior: a, delta: variacaoPct(v, a) } };
      })()
    : logs;

  const taxa: Dashboard["kpis"]["taxa"] = logs.ok
    ? (() => {
        const atual = taxaConversao(logsDesde(logs.dados, inicio30));
        const ant = taxaConversao(logs.dados.filter((l) => l.createdAt >= inicio60 && l.createdAt < inicio30));
        return {
          ok: true as const,
          dados: {
            valor: atual.taxa,
            anterior: ant.taxa,
            delta: atual.taxa !== null && ant.taxa !== null ? Math.round((atual.taxa - ant.taxa) * 10) / 10 : null,
            comentarios: atual.comentarios,
            enviadas: atual.enviadas,
          },
        };
      })()
    : logs;

  // Estatísticas do card do Instagram vindas do próprio banco (DMs e comentários).
  const statsIg: StatPlataforma[] = [];
  if (serieIgCompleta) {
    const { atual, anterior } = ultimoEAnterior(serieIgCompleta);
    if (atual !== null && anterior !== null) statsIg.push({ rotulo: "Ganho em 7 dias", valor: atual - anterior, formato: "numero", delta: null });
  }
  if (logs.ok) {
    const c7 = logsDesde(logs.dados, inicio7).filter(ehComentarioDeCampanha).length;
    const c14 = logs.dados.filter((l) => l.createdAt >= inicio14 && l.createdAt < inicio7 && ehComentarioDeCampanha(l)).length;
    statsIg.push({ rotulo: "Comentários 7d", valor: c7, formato: "numero", delta: variacaoPct(c7, c14) });
    if (dms7d.ok) statsIg.push({ rotulo: "DMs enviadas 7d", valor: dms7d.dados.valor ?? 0, formato: "numero", delta: dms7d.dados.delta });
    if (taxa.ok && taxa.dados.valor !== null) statsIg.push({ rotulo: "Comentário → DM", valor: taxa.dados.valor, formato: "pct", delta: null });
  }

  const plataformas: Dashboard["plataformas"] =
    !snaps.ok && !pontosIg.ok
      ? { ok: false, motivo: snaps.motivo }
      : { ok: true, dados: cardsPlataforma(snapsLista, serieIgCompleta ? { serie: serieIgCompleta, coletadoEm: coletaIg, stats: statsIg } : null) };

  return {
    geradoEm: agora,
    kpis: { seguidores: seguidoresKpi, dms7d, taxa, posts, gasto },
    plataformas,
    seguidores: !pontosIg.ok
      ? { ok: false, motivo: pontosIg.motivo }
      : { ok: true, dados: porPeriodo((n) => (serie90 ?? []).slice(90 - n)) },
    dms: logs.ok ? { ok: true, dados: porPeriodo((n) => dmsPorDia(logs.dados, dias[n])) } : logs,
    palavras: logs.ok ? { ok: true, dados: porPeriodo((n) => conversaoPorPalavra(logsDesde(logs.dados, inicioJanela(agora, n)))) } : logs,
    audiencia: seguidoresKpi.ok ? { ok: true, dados: distribuicaoAudiencia(tot.redes) } : { ok: false, motivo: seguidoresKpi.motivo },
    horario: logs.ok ? { ok: true, dados: porPeriodo((n) => horarioComentarios(logsDesde(logs.dados, inicioJanela(agora, n)))) } : logs,
  };
}
