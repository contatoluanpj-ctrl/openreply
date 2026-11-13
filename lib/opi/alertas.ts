// Alerta no Telegram só para FALHA (Luan, 12/11/2026): post que não publicou, DM que falhou de vez e token do
// Instagram que não renovou. Reaproveita o envio de lib/opi/jev-gate.ts (mesmo bot e chat). Não tem relação com
// os avisos de comentário, que continuam desligados (telegramComentariosLigado).
// - Sem OPI_TELEGRAM_BOT_TOKEN (ou sem o chat) fica mudo: não envia e não grava nada.
// - O mesmo alerta (mesma chave) não se repete em menos de 6 h. O registro do que já saiu fica em
//   OperationalEvent (message = "opi.alerta.falha:<chave>", nível INFO), sem tabela nova.
// - Nunca lança: falha ao alertar não pode derrubar o publicador, o worker nem o cron.
import type { PrismaClient } from "@/app/generated/prisma/client";
import { avisarTelegram, type TelegramFetch } from "@/lib/opi/jev-gate";

export type TipoFalha = "post" | "dm" | "token";

export const PREFIXO_ALERTA = "opi.alerta.falha:";
export const JANELA_ALERTA_MS = 6 * 60 * 60 * 1000;

const TITULOS: Record<TipoFalha, string> = {
  post: "Post não publicado",
  dm: "DM falhou",
  token: "Token do Instagram não renovou",
};

type Env = Record<string, string | undefined>;
export type DbAlertas = Pick<PrismaClient, "operationalEvent">;

export type OpcoesAlerta = {
  /** Chave de dedupe. Padrão: tipo + resumo (sem números, para "job 12" e "job 13" contarem como o mesmo). */
  chave?: string;
  workspaceId?: string | null;
  env?: Env;
  fetchImpl?: TelegramFetch;
  db?: DbAlertas;
  agora?: Date;
};

export type ResultadoAlerta = "enviado" | "mudo" | "repetido" | "falhou";

/** Tira token e encurta: o texto vai para um chat, não pode levar segredo nem virar parede de texto. */
export function limparResumo(texto: string, max = 300): string {
  const t = texto
    .replace(/access_token=[^&\s"]+/gi, "access_token=[token]")
    .replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot[token]")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

export function chaveAlerta(tipo: TipoFalha, resumo: string): string {
  const base = resumo
    .toLowerCase()
    .replace(/\d+/g, "#")
    .replace(/[^a-z#à-ú]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${tipo}:${base || "geral"}`;
}

/** Link absoluto quando o endereço do painel é conhecido; caminho relativo sem base fica como está. */
export function linkAbsoluto(link: string, env: Env): string {
  if (/^https?:\/\//i.test(link)) return link;
  const base = (env.OPI_PAINEL_URL ?? env.NEXTAUTH_URL ?? "").trim().replace(/\/+$/, "");
  if (!base || /localhost|127\.0\.0\.1/.test(base)) return link;
  return `${base}${link.startsWith("/") ? "" : "/"}${link}`;
}

export function textoAlerta(tipo: TipoFalha, resumo: string, link: string, env: Env = {}): string {
  return [`OPI Central: ${TITULOS[tipo]}`, limparResumo(resumo), `Abrir: ${linkAbsoluto(link, env)}`].join("\n");
}

const fetchPadrao: TelegramFetch = (url, init) => fetch(url, init);

/**
 * Avisa o Luan no Telegram de uma falha. `link` é o caminho da tela que resolve (ex.: "/dashboard/calendario").
 * Devolve o que aconteceu, para teste e log; quem chama pode ignorar.
 */
export async function alertarFalha(
  tipo: TipoFalha,
  resumo: string,
  link: string,
  opcoes: OpcoesAlerta = {},
): Promise<ResultadoAlerta> {
  try {
    const env = opcoes.env ?? process.env;
    if (!(env.OPI_TELEGRAM_BOT_TOKEN ?? "").trim() || !(env.OPI_TELEGRAM_CHAT_ID ?? "").trim()) return "mudo";

    const agora = opcoes.agora ?? new Date();
    const message = PREFIXO_ALERTA + (opcoes.chave ?? chaveAlerta(tipo, resumo)).slice(0, 150);
    // Import tardio: quem só usa as funções puras (e os testes) não precisa do cliente do banco.
    const db = opcoes.db ?? (await import("@/lib/db/client")).prisma;

    const recente = await db.operationalEvent.findFirst({
      where: { message, createdAt: { gte: new Date(agora.getTime() - JANELA_ALERTA_MS) } },
      select: { id: true },
    });
    if (recente) return "repetido";

    const enviado = await avisarTelegram(textoAlerta(tipo, resumo, link, env), env, opcoes.fetchImpl ?? fetchPadrao);
    // Só registra o que saiu: se o Telegram estava fora, a próxima falha tenta de novo.
    if (!enviado) return "falhou";

    await db.operationalEvent.create({
      data: {
        workspaceId: opcoes.workspaceId ?? null,
        source: "SYSTEM",
        level: "INFO",
        message,
        payload: { tipo, link },
        createdAt: agora,
      },
    });
    return "enviado";
  } catch (e) {
    console.error("[OPI Alertas] Não foi possível alertar:", e instanceof Error ? e.name : "erro");
    return "falhou";
  }
}

/**
 * Falha definitiva de um job do BullMQ: erro irrecuperável ou última tentativa. O evento "failed" dispara a cada
 * tentativa; o alerta só sai quando não haverá outra.
 */
export function falhaDefinitiva(
  job: { attemptsMade?: number; opts?: { attempts?: number } } | undefined,
  erro: { name?: string } | undefined,
): boolean {
  if (erro?.name === "UnrecoverableError") return true;
  if (!job) return true;
  return (job.attemptsMade ?? 0) >= (job.opts?.attempts ?? 1);
}
