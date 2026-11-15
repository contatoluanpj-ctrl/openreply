import { temAviso } from "@/lib/opi/aviso";
import { COMPOSIO_NAO_CONFIGURADO, composioConfig, executarFerramenta } from "@/lib/opi/publicadores/composio";
import {
  PublicadorErro,
  aguardando,
  listaMidias,
  type DestinoParaPublicar,
  type PostParaPublicar,
  type ResultadoDestino,
} from "@/lib/opi/publicadores/tipos";

/**
 * Threads pelo Composio, ferramenta THREADS_CREATE_POST (esquema lido do Composio em 14/11/2026):
 *   entrada  { media_type: "TEXT" | "IMAGE" | "VIDEO" | "CAROUSEL", text (até 500 bytes UTF-8), video_url (URL pública) }
 *   saída    data { post_id, permalink?, container_id, publication_status: "PUBLISHED" }
 * A conta é a pessoal do Luan: como LinkedIn e X, o destino nunca é criado sozinho e só sai depois de
 * aprovado (PostDestino.aprovadoEm). O texto é o do próprio destino (descricao), nunca a legenda do Reel
 * (que passa de 500 bytes). Reel com 1 vídeo sai como vídeo: a URL pública da mídia vai direto para a
 * ferramenta, sem upload. Qualquer outro post sai só com o texto.
 */
export const THREADS_FERRAMENTA = "THREADS_CREATE_POST";
export const THREADS_TEXTO_MAX_BYTES = 500;
export const THREADS_SEM_CONTA = "Threads ainda não conectado (falta COMPOSIO_THREADS_ACCOUNT_ID)";

/** O limite do Threads é em bytes UTF-8, não em caracteres (acento conta 2). */
export const bytesUtf8 = (texto: string): number => new TextEncoder().encode(texto).length;

type Env = Record<string, string | undefined>;

export async function publicarThreads(
  post: PostParaPublicar,
  destino: DestinoParaPublicar,
  ctx: { fetch: typeof fetch; env?: Env },
): Promise<ResultadoDestino> {
  if (!destino.aprovadoEm) return aguardando("Threads só publica destino aprovado");
  const cfg = composioConfig(ctx.env ?? process.env);
  if (!cfg) return aguardando(COMPOSIO_NAO_CONFIGURADO);
  if (!cfg.contas.threads) return aguardando(THREADS_SEM_CONTA);

  const texto = (destino.descricao ?? "").trim();
  if (!texto) throw new PublicadorErro("Threads sem texto próprio no destino");
  if (bytesUtf8(texto) > THREADS_TEXTO_MAX_BYTES) {
    throw new PublicadorErro(`Texto do Threads passa de ${THREADS_TEXTO_MAX_BYTES} bytes (acento conta 2)`);
  }
  if (!temAviso(texto)) throw new PublicadorErro("Texto do Threads sem o aviso obrigatório. Nada foi publicado.");

  const midias = listaMidias(post.midias);
  const video = post.tipo === "REEL" && midias.length === 1 ? midias[0] : null;
  const argumentos = video ? { media_type: "VIDEO", video_url: video, text: texto } : { media_type: "TEXT", text: texto };

  const dados = await executarFerramenta(cfg, THREADS_FERRAMENTA, argumentos, { fetch: ctx.fetch, contaId: cfg.contas.threads });
  const id = [dados.post_id, dados.id].find((v): v is string => typeof v === "string" && v.length > 0) ?? "";
  // A ferramenta respondeu com sucesso: o post saiu. Sem id não há como repetir com segurança.
  if (!id) throw new PublicadorErro("O Threads aceitou o post, mas não devolveu o id. Confira no perfil.");
  const permalink = typeof dados.permalink === "string" && dados.permalink.startsWith("https://") ? dados.permalink : null;
  return { situacao: "publicado", externoId: id, permalink };
}
