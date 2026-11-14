import { GraphErro, chamarGraph, idDe, type PublicarDeps } from "@/lib/opi/publicadores/graph";
import { esperaPadrao, listaMidias, type PostParaPublicar } from "@/lib/opi/publicadores/tipos";

/**
 * Instagram pela Graph API (Facebook Login for Business) com o token da Página:
 * `{igUserId}/media` (container) e `{igUserId}/media_publish`. Código extraído de lib/opi/publicador.ts
 * sem mudança de comportamento.
 */

export type ResultadoPublicacao = { mediaId: string; permalink: string | null };

async function esperarContainer(deps: PublicarDeps, containerId: string): Promise<void> {
  const esperar = deps.esperar ?? esperaPadrao;
  const intervalo = deps.intervaloReelMs ?? 10_000;
  const tentativas = deps.tentativasReel ?? 30;
  for (let i = 0; i < tentativas; i++) {
    const dados = await chamarGraph(deps, "GET", containerId, { fields: "status_code" });
    const status = String(dados.status_code ?? "");
    if (status === "FINISHED") return;
    if (status === "ERROR" || status === "EXPIRED") {
      throw new GraphErro(`O Instagram recusou o vídeo (status ${status})`);
    }
    await esperar(intervalo);
  }
  throw new GraphErro("O vídeo não terminou de processar a tempo");
}

/** Publica um post na conta do Instagram. Lança GraphErro com mensagem curta e sem token. */
export async function publicarPost(post: PostParaPublicar, deps: PublicarDeps): Promise<ResultadoPublicacao> {
  const midias = listaMidias(post.midias);
  const ig = deps.igUserId;
  let containerId: string;

  if (post.tipo === "CARROSSEL") {
    if (midias.length < 2 || midias.length > 10) throw new GraphErro("Carrossel precisa de 2 a 10 imagens");
    const filhos: string[] = [];
    for (const url of midias) {
      const filho = await chamarGraph(deps, "POST", `${ig}/media`, { image_url: url, is_carousel_item: "true" });
      filhos.push(idDe(filho, "item do carrossel"));
    }
    const carrossel = await chamarGraph(deps, "POST", `${ig}/media`, {
      media_type: "CAROUSEL",
      children: filhos.join(","),
      caption: post.legenda,
    });
    containerId = idDe(carrossel, "carrossel");
  } else if (post.tipo === "REEL") {
    if (midias.length !== 1) throw new GraphErro("Reel leva exatamente 1 vídeo");
    const reel = await chamarGraph(deps, "POST", `${ig}/media`, {
      media_type: "REELS",
      video_url: midias[0],
      caption: post.legenda,
    });
    containerId = idDe(reel, "reel");
    await esperarContainer(deps, containerId);
  } else {
    if (midias.length !== 1) throw new GraphErro("Post leva exatamente 1 imagem");
    const imagem = await chamarGraph(deps, "POST", `${ig}/media`, { image_url: midias[0], caption: post.legenda });
    containerId = idDe(imagem, "imagem");
  }

  const publicado = await chamarGraph(deps, "POST", `${ig}/media_publish`, { creation_id: containerId });
  const mediaId = idDe(publicado, "media_publish");

  let permalink: string | null = null;
  try {
    const info = await chamarGraph(deps, "GET", mediaId, { fields: "permalink" });
    permalink = typeof info.permalink === "string" ? info.permalink : null;
  } catch {
    permalink = null; // já publicado; o link é só conveniência
  }
  return { mediaId, permalink };
}
