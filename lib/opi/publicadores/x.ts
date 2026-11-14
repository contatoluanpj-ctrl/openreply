import { temAviso } from "@/lib/opi/aviso";
import { COMPOSIO_NAO_CONFIGURADO, composioConfig, executarFerramenta } from "@/lib/opi/publicadores/composio";
import {
  PublicadorErro,
  aguardando,
  type DestinoParaPublicar,
  type PostParaPublicar,
  type ResultadoDestino,
} from "@/lib/opi/publicadores/tipos";

/**
 * X pelo Composio, ferramenta TWITTER_CREATION_OF_A_POST (campo text; a resposta traz data.data.id).
 * ESQUELETO: publica só texto. Como o LinkedIn, o destino nunca é criado sozinho e só sai depois de
 * aprovado (PostDestino.aprovadoEm), com o texto do próprio destino (descricao).
 */
export const X_FERRAMENTA = "TWITTER_CREATION_OF_A_POST";
export const X_TEXTO_MAX = 280;

type Env = Record<string, string | undefined>;

export async function publicarX(
  _post: PostParaPublicar,
  destino: DestinoParaPublicar,
  ctx: { fetch: typeof fetch; env?: Env },
): Promise<ResultadoDestino> {
  if (!destino.aprovadoEm) return aguardando("X só publica destino aprovado");
  const cfg = composioConfig(ctx.env ?? process.env);
  if (!cfg) return aguardando(COMPOSIO_NAO_CONFIGURADO);

  const texto = (destino.descricao ?? "").trim();
  if (!texto) throw new PublicadorErro("X sem texto próprio no destino");
  if (texto.length > X_TEXTO_MAX) throw new PublicadorErro(`Texto do X passa de ${X_TEXTO_MAX} caracteres`);
  if (!temAviso(texto)) throw new PublicadorErro("Texto do X sem o aviso obrigatório. Nada foi publicado.");

  const dados = await executarFerramenta(cfg, X_FERRAMENTA, { text: texto }, { fetch: ctx.fetch, contaId: cfg.contas.x });
  const tweet = (dados.data ?? dados) as { id?: unknown };
  const id = typeof tweet.id === "string" ? tweet.id : "";
  if (!id) throw new PublicadorErro("O X aceitou o post, mas não devolveu o id. Confira no perfil.");
  return { situacao: "publicado", externoId: id, permalink: `https://x.com/i/web/status/${id}` };
}
