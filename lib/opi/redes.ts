import { z } from "zod";

/** Redes acompanhadas pelo OPI Central, na ordem fixa do grid. */
export const REDE_IDS = [
  "instagram",
  "facebook",
  "youtube",
  "tiktok",
  "linkedin",
  "x",
  "threads",
  "meta_ads",
  "google_ads",
] as const;
export type RedeId = (typeof REDE_IDS)[number];

export const ESTADOS = ["conectado", "sem_dados", "sem_conta"] as const;
export type RedeEstado = (typeof ESTADOS)[number];

export type RedeTipo = "social" | "ads";

export interface RedeDef {
  id: RedeId;
  nome: string;
  tipo: RedeTipo;
  funcoes: string[];
  /** Estado quando não há nenhum snapshot. */
  estadoPadrao: RedeEstado;
}

const PUBLICA = "Publicação onde a API permite";
const ADS = "Gasto e campanhas (só leitura)";

export const REDES: RedeDef[] = [
  { id: "instagram", nome: "Instagram", tipo: "social", funcoes: ["Métricas", "Publicação via API (calendário aprovado)", "DMs por palavra"], estadoPadrao: "sem_dados" },
  { id: "facebook", nome: "Facebook", tipo: "social", funcoes: ["Métricas da Página", PUBLICA], estadoPadrao: "sem_dados" },
  { id: "youtube", nome: "YouTube", tipo: "social", funcoes: ["Métricas do canal", PUBLICA], estadoPadrao: "sem_dados" },
  { id: "tiktok", nome: "TikTok", tipo: "social", funcoes: ["Métricas", PUBLICA], estadoPadrao: "sem_dados" },
  { id: "linkedin", nome: "LinkedIn", tipo: "social", funcoes: ["Métricas", PUBLICA], estadoPadrao: "sem_dados" },
  { id: "x", nome: "X", tipo: "social", funcoes: ["Métricas", PUBLICA], estadoPadrao: "sem_dados" },
  { id: "threads", nome: "Threads", tipo: "social", funcoes: ["Métricas", PUBLICA], estadoPadrao: "sem_dados" },
  { id: "meta_ads", nome: "Meta Ads", tipo: "ads", funcoes: [ADS, "Nenhum gasto pelo painel"], estadoPadrao: "sem_dados" },
  { id: "google_ads", nome: "Google Ads", tipo: "ads", funcoes: [ADS, "Nenhum gasto pelo painel"], estadoPadrao: "sem_conta" },
];

export const ESTADO_ROTULO: Record<RedeEstado, string> = {
  conectado: "Conectado",
  sem_dados: "Sem dados",
  sem_conta: "Sem conta",
};

const metricaValor = z.union([z.number().finite(), z.string().max(200), z.null()]);

/** Corpo do POST /api/opi/redes/snapshot. O workspace vem da chave, nunca do corpo (.strict()). */
export const snapshotSchema = z
  .object({
    rede: z.enum(REDE_IDS),
    estado: z.enum(ESTADOS),
    metricas: z
      .record(z.string().min(1).max(40), metricaValor)
      .refine((m) => Object.keys(m).length <= 30, { message: "No máximo 30 métricas" }),
    coletadoEm: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();
export type SnapshotInput = z.infer<typeof snapshotSchema>;

export type Metricas = Record<string, number | string | null>;

export interface SnapshotRow {
  rede: string;
  estado: string;
  metricas: unknown;
  coletadoEm: Date | string;
}

export interface IgFollowers {
  followersCount: number;
  date: Date | string;
}

export interface RedeView {
  id: RedeId;
  nome: string;
  tipo: RedeTipo;
  funcoes: string[];
  estado: RedeEstado;
  metricas: Metricas;
  coletadoEm: string | null;
}

function toIso(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function asMetricas(value: unknown): Metricas {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Metricas = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === "number" || typeof v === "string" || v === null) out[k] = v;
  }
  return out;
}

function asEstado(value: string): RedeEstado | null {
  return (ESTADOS as readonly string[]).includes(value) ? (value as RedeEstado) : null;
}

/**
 * Monta a lista final das 9 redes a partir dos snapshots (qualquer ordem; vale o mais recente
 * de cada rede) e, opcionalmente, do último FollowerSnapshot real do Instagram.
 */
export function montarRedes(snapshots: SnapshotRow[], igFollowers?: IgFollowers | null): RedeView[] {
  const ultimo = new Map<string, SnapshotRow>();
  for (const s of snapshots) {
    const atual = ultimo.get(s.rede);
    if (!atual || new Date(s.coletadoEm).getTime() > new Date(atual.coletadoEm).getTime()) ultimo.set(s.rede, s);
  }
  return REDES.map((def) => {
    const snap = ultimo.get(def.id);
    let estado: RedeEstado = snap ? asEstado(snap.estado) ?? def.estadoPadrao : def.estadoPadrao;
    const metricas = snap ? asMetricas(snap.metricas) : {};
    let coletadoEm = snap ? toIso(snap.coletadoEm) : null;
    if (def.id === "instagram" && igFollowers) {
      metricas.seguidores = igFollowers.followersCount;
      estado = "conectado";
      const igDate = toIso(igFollowers.date);
      if (!coletadoEm || igDate > coletadoEm) coletadoEm = igDate;
    }
    return { id: def.id, nome: def.nome, tipo: def.tipo, funcoes: def.funcoes, estado, metricas, coletadoEm };
  });
}

const ROTULOS_METRICA: Record<string, string> = {
  seguidores: "Seguidores",
  inscritos: "Inscritos",
  alcance: "Alcance",
  impressoes: "Impressões",
  visualizacoes: "Visualizações",
  engajamento: "Engajamento",
  curtidas: "Curtidas",
  comentarios: "Comentários",
  publicacoes: "Publicações",
  gasto: "Gasto",
  cliques: "Cliques",
  ctr: "CTR",
  campanhas: "Campanhas",
};

export function rotuloMetrica(chave: string) {
  return ROTULOS_METRICA[chave] ?? chave.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}
