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
 * LinkedIn pelo Composio, ferramenta LINKEDIN_CREATE_LINKED_IN_POST (obrigatórios: author, commentary).
 * ESQUELETO: publica só texto. O publicador automático não cria este destino; ele só sai quando foi
 * criado à mão e aprovado (PostDestino.aprovadoEm). O texto é o do próprio destino (descricao), nunca a
 * legenda do Reel. O autor (urn:li:person:... ou urn:li:organization:...) vem de OPI_LINKEDIN_AUTOR_URN.
 */
export const LINKEDIN_FERRAMENTA = "LINKEDIN_CREATE_LINKED_IN_POST";
export const LINKEDIN_TEXTO_MAX = 3000;
const URN = /^urn:li:(person|organization):[A-Za-z0-9_-]+$/;

type Env = Record<string, string | undefined>;

export async function publicarLinkedin(
  _post: PostParaPublicar,
  destino: DestinoParaPublicar,
  ctx: { fetch: typeof fetch; env?: Env },
): Promise<ResultadoDestino> {
  if (!destino.aprovadoEm) return aguardando("LinkedIn só publica destino aprovado");
  const env = ctx.env ?? process.env;
  const cfg = composioConfig(env);
  if (!cfg) return aguardando(COMPOSIO_NAO_CONFIGURADO);

  const autor = (env.OPI_LINKEDIN_AUTOR_URN ?? "").trim();
  if (!URN.test(autor)) throw new PublicadorErro("OPI_LINKEDIN_AUTOR_URN ausente ou inválido");
  const texto = (destino.descricao ?? "").trim();
  if (!texto) throw new PublicadorErro("LinkedIn sem texto próprio no destino");
  if (texto.length > LINKEDIN_TEXTO_MAX) throw new PublicadorErro(`Texto do LinkedIn passa de ${LINKEDIN_TEXTO_MAX} caracteres`);
  if (!temAviso(texto)) throw new PublicadorErro("Texto do LinkedIn sem o aviso obrigatório. Nada foi publicado.");

  const dados = await executarFerramenta(
    cfg,
    LINKEDIN_FERRAMENTA,
    { author: autor, commentary: texto, visibility: "PUBLIC" },
    { fetch: ctx.fetch, contaId: cfg.contas.linkedin },
  );
  const id = [dados.x_restli_id, dados.id].find((v): v is string => typeof v === "string" && v.length > 0) ?? "";
  if (!id) throw new PublicadorErro("O LinkedIn aceitou o post, mas não devolveu o id. Confira no perfil.");
  return { situacao: "publicado", externoId: id, permalink: `https://www.linkedin.com/feed/update/${id}/` };
}
