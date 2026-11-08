import { z } from "zod";
import { FRASE_RESPOSTA_PUBLICA, normalizar } from "@/lib/opi/jev-gate";
import { AVISO_COMPLIANCE, AVISO_OBRIGATORIO } from "@/lib/opi/palavras-constantes";

// OPI Central — Palavras-chave: regras dos textos aprovados (TextoAprovado) e das campanhas que usam cada palavra.

export { AVISO_OBRIGATORIO, AVISO_COMPLIANCE };

const palavraSchema = z
  .string()
  .trim()
  .min(1, "Informe a palavra")
  .max(40, "Palavra com no máximo 40 caracteres")
  .transform((s) => s.toUpperCase());

const dmSchema = z
  .string()
  .trim()
  .min(1, "Informe o texto da DM")
  .max(1000, "DM com no máximo 1000 caracteres")
  .refine((s) => s.replace(/\r\n/g, "\n").includes(AVISO_OBRIGATORIO), {
    message: `A DM precisa conter o aviso: "${AVISO_OBRIGATORIO}"`,
  });

const respostaSchema = z.string().trim().min(1).max(300);

export const criarTextoSchema = z.object({
  palavra: palavraSchema,
  dmMessage: dmSchema,
  respostaPublica: respostaSchema.optional().default(FRASE_RESPOSTA_PUBLICA),
  ativo: z.boolean().optional().default(true),
});

export const editarTextoSchema = z
  .object({
    palavra: palavraSchema.optional(),
    dmMessage: dmSchema.optional(),
    respostaPublica: respostaSchema.optional(),
    ativo: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nada para alterar" });

export type MotivoPausa = "ativa" | "aguardando_revisao" | "pausada";

/**
 * Motivo derivado sem mudar o schema. O portão (reservarPrimeiraDm) desliga a campanha ao mandar a 1ª DM de cada
 * texto: inativa com exatamente 1 DmLog SENT do texto atual = aguardando a revisão do Luan. Qualquer outro caso
 * inativo = pausada (manual, freio, etc.).
 */
export function motivoPausa(isActive: boolean, enviadosComTextoAtual: number): MotivoPausa {
  if (isActive) return "ativa";
  return enviadosComTextoAtual === 1 ? "aguardando_revisao" : "pausada";
}

/** A campanha usa a palavra se alguma keyword normalizada (mesma regra do portão) for igual à palavra. */
export function campanhaUsaPalavra(keywords: readonly string[] | null | undefined, palavra: string): boolean {
  const alvo = normalizar(palavra);
  if (!alvo) return false;
  return (keywords ?? []).some((k) => normalizar(k) === alvo);
}

/** Estados de DmLog em que a DM não saiu e o Luan pode pedir reprocessamento. */
export const STATUS_SEM_DM = [
  "HELD_FOR_REVIEW",
  "FAILED",
  "SKIPPED_DEDUP",
  "SKIPPED_RATE_LIMIT",
  "SKIPPED_PLAN_LIMIT",
  "SKIPPED_NO_MATCH",
] as const;
export type StatusSemDm = (typeof STATUS_SEM_DM)[number];

export function isStatusSemDm(s: string): s is StatusSemDm {
  return (STATUS_SEM_DM as readonly string[]).includes(s);
}

/** Mesmo jobId do webhook (lib/queue/process-webhook.ts). */
export function jobIdDoComentario(instagramId: string, commentId: string): string {
  return `comment_${instagramId}_${commentId}`;
}

/**
 * Motivo para recusar o reprocessamento, ou null. Apagar o DmLog perde as marcas de envio; com qualquer uma delas o
 * worker mandaria de novo a DM ou a resposta pública.
 */
export function motivoNaoReprocessar(log: {
  status: string;
  dmSentAt: Date | null;
  publicReplySentAt: Date | null;
  dmDeliveryUnconfirmed: boolean;
  publicReplyDeliveryUnconfirmed: boolean;
}): string | null {
  if (!isStatusSemDm(log.status)) return "Esse comentário não está num estado sem DM.";
  if (log.dmSentAt) return "A DM desse comentário já saiu.";
  if (log.publicReplySentAt) return "A resposta pública já saiu; reprocessar repetiria a resposta.";
  if (log.dmDeliveryUnconfirmed || log.publicReplyDeliveryUnconfirmed)
    return "Envio sem confirmação do Instagram; confira no app antes de reprocessar.";
  return null;
}
