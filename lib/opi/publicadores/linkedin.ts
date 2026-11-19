import { temAviso } from "@/lib/opi/aviso";
import {
  COMPOSIO_NAO_CONFIGURADO,
  baixarMidia,
  composioConfig,
  enviarArquivo,
  executarFerramenta,
  type ArquivoComposio,
} from "@/lib/opi/publicadores/composio";
import { urnDoLinkedin } from "@/lib/opi/redes-teste";
import {
  PublicadorErro,
  aguardando,
  listaMidias,
  textoDoDestino,
  type DestinoParaPublicar,
  type PostParaPublicar,
  type ResultadoDestino,
} from "@/lib/opi/publicadores/tipos";

/**
 * LinkedIn pelo Composio, ferramenta LINKEDIN_CREATE_LINKED_IN_POST (obrigatórios: author, commentary).
 * Só sai destino aprovado (PostDestino.aprovadoEm). O texto é o do próprio destino (descricao) ou, no post
 * do tipo TEXTO, a legenda do post; nunca a legenda do Reel. O autor (urn:li:person:... ou
 * urn:li:organization:...) vem de OPI_LINKEDIN_AUTOR_URN ou, sem ela, do perfil conectado (LINKEDIN_GET_MY_INFO).
 *
 * Imagem (esquema lido do Composio em 19/11/2026): o campo `images` recebe [{ name, mimetype, s3key }],
 * o mesmo formato de arquivo do YouTube. Só o post do tipo TEXTO manda imagem, e no máximo uma. A imagem é
 * baixada, conferida pelos primeiros bytes (png, jpg ou gif) e enviada ao armazenamento do Composio antes da
 * chamada que publica: se algo falhar até ali, nada saiu.
 */
export const LINKEDIN_FERRAMENTA = "LINKEDIN_CREATE_LINKED_IN_POST";
export const LINKEDIN_TEXTO_MAX = 3000;
export const LINKEDIN_IMAGEM_MAX_BYTES = 8 * 1024 * 1024;
const URN = /^urn:li:(person|organization):[A-Za-z0-9_-]+$/;

export type TipoImagem = "image/png" | "image/jpeg" | "image/gif";

/** Tipo da imagem pelos primeiros bytes. O cabeçalho do servidor e a extensão não são confiáveis. */
export function tipoDaImagem(bytes: Uint8Array): TipoImagem | null {
  const inicia = (...assinatura: number[]) => assinatura.every((b, i) => bytes[i] === b);
  if (inicia(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (inicia(0xff, 0xd8, 0xff)) return "image/jpeg";
  if (inicia(0x47, 0x49, 0x46, 0x38)) return "image/gif";
  return null;
}

/** URL da imagem do post de texto, ou null. Vídeo de Reel e imagem do Instagram nunca vão ao LinkedIn por aqui. */
export function imagemDoPostDeTexto(post: PostParaPublicar): string | null {
  if (post.tipo !== "TEXTO") return null;
  const brutas = Array.isArray(post.midias) ? post.midias.length : 0;
  if (brutas === 0) return null;
  const urls = listaMidias(post.midias);
  // Mídia que não é URL https, ou mais de uma: melhor falhar do que publicar o post sem a imagem aprovada.
  if (brutas !== 1 || urls.length !== 1) throw new PublicadorErro("Imagem do post de texto inválida (uma URL https). Nada foi publicado.");
  return urls[0];
}

type Env = Record<string, string | undefined>;

export async function publicarLinkedin(
  post: PostParaPublicar,
  destino: DestinoParaPublicar,
  ctx: { fetch: typeof fetch; env?: Env },
): Promise<ResultadoDestino> {
  if (!destino.aprovadoEm) return aguardando("LinkedIn só publica destino aprovado");
  const env = ctx.env ?? process.env;
  const cfg = composioConfig(env);
  if (!cfg) return aguardando(COMPOSIO_NAO_CONFIGURADO);

  const texto = textoDoDestino(post, destino);
  if (!texto) throw new PublicadorErro("LinkedIn sem texto próprio no destino");
  if (texto.length > LINKEDIN_TEXTO_MAX) throw new PublicadorErro(`Texto do LinkedIn passa de ${LINKEDIN_TEXTO_MAX} caracteres`);
  if (!temAviso(texto)) throw new PublicadorErro("Texto do LinkedIn sem o aviso obrigatório. Nada foi publicado.");

  // Autor: OPI_LINKEDIN_AUTOR_URN quando existe; senão o próprio perfil conectado (leitura, nada é publicado aqui).
  let autor = (env.OPI_LINKEDIN_AUTOR_URN ?? "").trim();
  if (!autor) {
    let perfil: Record<string, unknown>;
    try {
      perfil = await executarFerramenta(cfg, "LINKEDIN_GET_MY_INFO", {}, { fetch: ctx.fetch, contaId: cfg.contas.linkedin });
    } catch (e) {
      throw new PublicadorErro(`Não foi possível ler o perfil do LinkedIn: ${e instanceof Error ? e.message : "erro"}`.slice(0, 300), {
        repetivel: true,
      });
    }
    autor = urnDoLinkedin(perfil) ?? "";
  }
  if (!URN.test(autor)) throw new PublicadorErro("Autor do LinkedIn ausente ou inválido (OPI_LINKEDIN_AUTOR_URN)");

  // Imagem (só no post de texto): baixa, confere e manda ao Composio. Falha aqui é antes de publicar.
  const urlImagem = imagemDoPostDeTexto(post);
  let imagem: ArquivoComposio | null = null;
  if (urlImagem) {
    const midia = await baixarMidia(urlImagem, ctx.fetch, LINKEDIN_IMAGEM_MAX_BYTES);
    const mimetype = tipoDaImagem(midia.bytes);
    if (!mimetype) throw new PublicadorErro("O arquivo do post de texto não é imagem (png, jpg ou gif). Nada foi publicado.");
    imagem = await enviarArquivo(
      cfg,
      { toolkitSlug: "linkedin", toolSlug: LINKEDIN_FERRAMENTA, nome: midia.nome, mimetype, bytes: midia.bytes },
      ctx.fetch,
    );
  }

  const argumentos: Record<string, unknown> = { author: autor, commentary: texto, visibility: "PUBLIC" };
  if (imagem) argumentos.images = [imagem];
  const dados = await executarFerramenta(cfg, LINKEDIN_FERRAMENTA, argumentos, { fetch: ctx.fetch, contaId: cfg.contas.linkedin });
  const id = [dados.x_restli_id, dados.id].find((v): v is string => typeof v === "string" && v.length > 0) ?? "";
  if (!id) throw new PublicadorErro("O LinkedIn aceitou o post, mas não devolveu o id. Confira no perfil.");
  return { situacao: "publicado", externoId: id, permalink: `https://www.linkedin.com/feed/update/${id}/` };
}
