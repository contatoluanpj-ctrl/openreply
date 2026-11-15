import { temAviso } from "@/lib/opi/aviso";
import {
  COMPOSIO_NAO_CONFIGURADO,
  ComposioErro,
  baixarMidia,
  composioConfig,
  enviarArquivo,
  executarFerramenta,
} from "@/lib/opi/publicadores/composio";
import {
  PublicadorErro,
  aguardando,
  listaMidias,
  pulado,
  type DestinoParaPublicar,
  type PostParaPublicar,
  type ResultadoDestino,
} from "@/lib/opi/publicadores/tipos";

/**
 * Short no YouTube pelo Composio, ferramenta YOUTUBE_UPLOAD_VIDEO.
 * Campos obrigatórios (esquema lido do Composio em 14/11/2026): title, description, tags, categoryId,
 * privacyStatus, videoFilePath { name, mimetype, s3key }. A resposta traz data.response_data.id.
 * O vídeo vai antes para o armazenamento do Composio (ver composio.ts).
 */
export const YOUTUBE_FERRAMENTA = "YOUTUBE_UPLOAD_VIDEO";
export const YOUTUBE_CATEGORIA_EDUCACAO = "27";
export const YOUTUBE_TITULO_MAX = 100;
const PRIVACIDADES = ["private", "unlisted", "public"] as const;
export type PrivacidadeYoutube = (typeof PRIVACIDADES)[number];

type Env = Record<string, string | undefined>;

/** OPI_YOUTUBE_PRIVACIDADE: private (padrão, até o Luan liberar), unlisted ou public. */
export function privacidadeYoutube(env: Env = process.env): PrivacidadeYoutube {
  const v = (env.OPI_YOUTUBE_PRIVACIDADE ?? "").trim().toLowerCase();
  return (PRIVACIDADES as readonly string[]).includes(v) ? (v as PrivacidadeYoutube) : "private";
}

/**
 * Cota da API do YouTube (visto em 14/11/2026, 22h27: "you have exceeded your quota", HTTP 403).
 * O login gerenciado do Composio usa um app do Google compartilhado, e a cota diária dele acaba.
 * Quando o Google recusa por cota, é certo que nada foi publicado: o destino NÃO vira ERRO. Fica
 * PENDENTE com o motivo escrito e o publicador tenta de novo sozinho, no máximo uma vez a cada
 * YOUTUBE_ESPERA_COTA_MS (cada tentativa baixa e reenvia o vídeo). A cota volta à meia-noite do
 * Pacífico (5h de Brasília).
 */
export const YOUTUBE_SEM_COTA = "YouTube sem cota agora (app compartilhado do Composio). Nada foi publicado; tenta de novo sozinho.";
export const YOUTUBE_ESPERA_COTA_MS = 15 * 60_000;
const COTA = /quota|uploadLimitExceeded|rateLimitExceeded/i;
let semCotaAte = 0;

/** Só para os testes: esquece a espera por cota guardada na memória do processo. */
export function zerarEsperaCotaYoutube(): void {
  semCotaAte = 0;
}

/** Tags a partir das hashtags da descrição ("#Opções" -> "Opções"), sem repetir. */
export function tagsDaDescricao(descricao: string): string[] {
  const tags = new Set<string>();
  for (const m of descricao.matchAll(/#([\p{L}\p{N}_]+)/gu)) tags.add(m[1]);
  return [...tags].slice(0, 15);
}

export async function publicarYoutube(
  post: PostParaPublicar,
  destino: DestinoParaPublicar,
  ctx: { fetch: typeof fetch; env?: Env; agora?: () => number },
): Promise<ResultadoDestino> {
  const agora = ctx.agora ?? Date.now;
  if (post.tipo !== "REEL") return pulado("O YouTube só recebe Reel (Short) pelo painel");
  const cfg = composioConfig(ctx.env ?? process.env);
  if (!cfg) return aguardando(COMPOSIO_NAO_CONFIGURADO);

  const titulo = (destino.titulo ?? "").trim();
  if (!titulo) throw new PublicadorErro("YouTube sem título. Preencha o título do Short antes de aprovar de novo.");
  if (titulo.length > YOUTUBE_TITULO_MAX) throw new PublicadorErro(`Título do YouTube passa de ${YOUTUBE_TITULO_MAX} caracteres.`);
  const descricao = (destino.descricao ?? "").trim() || post.legenda;
  if (!temAviso(descricao)) {
    throw new PublicadorErro("Descrição do YouTube sem o aviso obrigatório. Nada foi publicado.");
  }
  const midias = listaMidias(post.midias);
  if (midias.length !== 1) throw new PublicadorErro("Short leva exatamente 1 vídeo");
  // Cota recusada há pouco: espera, sem baixar nem reenviar o vídeo a cada minuto.
  if (agora() < semCotaAte) return aguardando(YOUTUBE_SEM_COTA);

  const midia = await baixarMidia(midias[0], ctx.fetch);
  const arquivo = await enviarArquivo(
    cfg,
    { toolkitSlug: "youtube", toolSlug: YOUTUBE_FERRAMENTA, nome: midia.nome, mimetype: midia.mimetype, bytes: midia.bytes },
    ctx.fetch,
  );
  let dados: Record<string, unknown>;
  try {
    dados = await executarFerramenta(
      cfg,
      YOUTUBE_FERRAMENTA,
      {
        title: titulo,
        description: descricao,
        tags: tagsDaDescricao(descricao),
        categoryId: YOUTUBE_CATEGORIA_EDUCACAO,
        privacyStatus: privacidadeYoutube(ctx.env ?? process.env),
        videoFilePath: arquivo,
      },
      { fetch: ctx.fetch, contaId: cfg.contas.youtube },
    );
  } catch (e) {
    if (e instanceof ComposioErro && COTA.test(e.message)) {
      semCotaAte = agora() + YOUTUBE_ESPERA_COTA_MS;
      return aguardando(YOUTUBE_SEM_COTA);
    }
    throw e;
  }
  const video = (dados.response_data ?? dados) as { id?: unknown };
  const id = typeof video.id === "string" ? video.id : "";
  // A ferramenta respondeu com sucesso: o vídeo subiu. Sem id não há como repetir com segurança.
  if (!id) throw new PublicadorErro("O YouTube aceitou o envio, mas não devolveu o id do vídeo. Confira no canal.");
  return { situacao: "publicado", externoId: id, permalink: `https://www.youtube.com/shorts/${id}` };
}
