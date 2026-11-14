import { publicarReelFacebook } from "@/lib/opi/publicadores/facebook";
import type { PublicarDeps } from "@/lib/opi/publicadores/graph";
import { publicarPost } from "@/lib/opi/publicadores/instagram";
import { publicarLinkedin } from "@/lib/opi/publicadores/linkedin";
import {
  aguardando,
  pulado,
  type DestinoParaPublicar,
  type PostParaPublicar,
  type ResultadoDestino,
} from "@/lib/opi/publicadores/tipos";
import { publicarX } from "@/lib/opi/publicadores/x";
import { publicarYoutube } from "@/lib/opi/publicadores/youtube";

export type ContextoPublicacao = {
  /** Dependências da Graph (Instagram e Facebook). null quando a configuração da Meta está ausente. */
  graph: PublicarDeps | null;
  /** fetch das chamadas ao Composio e do download da mídia. */
  fetch: typeof fetch;
  env?: Record<string, string | undefined>;
};

export const META_AUSENTE = "Configuração da Meta ausente";

/** Publica um destino na rede dele. Rede sem publicador sai como PULADO. */
export async function publicarDestino(
  post: PostParaPublicar,
  destino: DestinoParaPublicar,
  ctx: ContextoPublicacao,
): Promise<ResultadoDestino> {
  switch (destino.rede) {
    case "instagram": {
      if (!ctx.graph) return aguardando(META_AUSENTE);
      const r = await publicarPost(post, ctx.graph);
      return { situacao: "publicado", externoId: r.mediaId, permalink: r.permalink };
    }
    case "facebook":
      if (!ctx.graph) return aguardando(META_AUSENTE);
      return publicarReelFacebook(post, ctx.graph);
    case "youtube":
      return publicarYoutube(post, destino, ctx);
    case "linkedin":
      return publicarLinkedin(post, destino, ctx);
    case "x":
      return publicarX(post, destino, ctx);
    default:
      return pulado("Rede sem publicador automático");
  }
}
