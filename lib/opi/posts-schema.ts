import { z } from "zod";

/**
 * Esquema do rascunho de post do calendário e utilitários de data.
 * Pode ser importado no cliente (sem dependência de servidor).
 *
 * Fuso: America/Sao_Paulo, que é UTC-3 fixo desde 2019 (sem horário de verão).
 */
export const FUSO_OFFSET = "-03:00";
const OFFSET_MS = 3 * 60 * 60 * 1000;

export const POST_TIPOS = ["CARROSSEL", "REEL", "POST"] as const;
export type PostTipoOpi = (typeof POST_TIPOS)[number];

export const POST_STATUS = ["RASCUNHO", "APROVADO", "PUBLICANDO", "PUBLICADO", "ERRO"] as const;
export type PostStatusOpi = (typeof POST_STATUS)[number];

export const LEGENDA_MAX = 2200;

const urlPublica = z
  .string()
  .trim()
  .url("URL inválida")
  .refine((u) => u.startsWith("https://"), "A URL precisa ser pública e começar com https://");

export const postRascunhoSchema = z
  .object({
    tipo: z.enum(POST_TIPOS),
    midias: z.array(urlPublica).min(1, "Informe ao menos uma mídia").max(10),
    legenda: z.string().trim().min(1, "Legenda vazia").max(LEGENDA_MAX),
    agendadoPara: z.string().datetime({ offset: true, message: "Data inválida" }),
  })
  .superRefine((v, ctx) => {
    if (v.tipo === "CARROSSEL" && v.midias.length < 2) {
      ctx.addIssue({ code: "custom", path: ["midias"], message: "Carrossel precisa de 2 a 10 imagens" });
    }
    if (v.tipo !== "CARROSSEL" && v.midias.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["midias"], message: "Post e Reel levam exatamente 1 mídia" });
    }
  });

export type PostRascunhoInput = z.infer<typeof postRascunhoSchema>;

const MES_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

export function mesValido(mes: string | null | undefined): mes is string {
  return !!mes && MES_RE.test(mes);
}

/** Intervalo [inicio, fim) do mês "AAAA-MM" no fuso de São Paulo. */
export function mesIntervalo(mes: string): { inicio: Date; fim: Date } {
  const m = MES_RE.exec(mes);
  if (!m) throw new Error("Mês inválido, use AAAA-MM");
  const ano = Number(m[1]);
  const mm = Number(m[2]);
  const proxAno = mm === 12 ? ano + 1 : ano;
  const proxMes = mm === 12 ? 1 : mm + 1;
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    inicio: new Date(`${ano}-${pad(mm)}-01T00:00:00${FUSO_OFFSET}`),
    fim: new Date(`${proxAno}-${pad(proxMes)}-01T00:00:00${FUSO_OFFSET}`),
  };
}

/** Mês atual "AAAA-MM" em São Paulo. */
export function mesAtual(agora = new Date()): string {
  return new Date(agora.getTime() - OFFSET_MS).toISOString().slice(0, 7);
}

export function deslocarMes(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number);
  const total = a * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

/** "AAAA-MM-DD" do instante no fuso de São Paulo. */
export function diaSP(data: Date | string): string {
  return new Date(new Date(data).getTime() - OFFSET_MS).toISOString().slice(0, 10);
}

/** "AAAA-MM-DDTHH:mm" (valor de input datetime-local) no fuso de São Paulo. */
export function paraInputSP(data: Date | string): string {
  return new Date(new Date(data).getTime() - OFFSET_MS).toISOString().slice(0, 16);
}

/** Converte o valor do datetime-local (lido como hora de São Paulo) para ISO UTC. */
export function deInputSP(valor: string): string {
  return new Date(`${valor}:00${FUSO_OFFSET}`).toISOString();
}

const FMT_HORA_SP = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "HH:mm" (24 h) no fuso America/Sao_Paulo, pelo Intl (não depende do fuso do navegador). */
export function horaSP(data: Date | string): string {
  const d = new Date(data);
  if (Number.isNaN(d.getTime())) return "--:--";
  const partes = FMT_HORA_SP.formatToParts(d);
  const h = partes.find((p) => p.type === "hour")?.value ?? "00";
  const m = partes.find((p) => p.type === "minute")?.value ?? "00";
  return `${h.padStart(2, "0")}:${m.padStart(2, "0")}`;
}
