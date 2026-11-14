import { GraphErro, chamarGraph, semToken, type PublicarDeps } from "@/lib/opi/publicadores/graph";
import {
  PublicadorErro,
  esperaPadrao,
  listaMidias,
  pulado,
  type PostParaPublicar,
  type ResultadoDestino,
} from "@/lib/opi/publicadores/tipos";

/**
 * Reel na Página do Facebook pela Graph API, com o mesmo token de Página do Instagram.
 * Doc: https://developers.facebook.com/docs/video-api/guides/reels-publishing
 *   1. POST /{page_id}/video_reels  upload_phase=start            -> video_id, upload_url
 *   2. POST {upload_url}            cabeçalhos Authorization: OAuth <token> e file_url: <vídeo>
 *   3. POST /{page_id}/video_reels  upload_phase=finish, video_state=PUBLISHED, description=<legenda>
 * Só Reel: os outros tipos saem como PULADO.
 */
export async function publicarReelFacebook(post: PostParaPublicar, deps: PublicarDeps): Promise<ResultadoDestino> {
  if (post.tipo !== "REEL") return pulado("O Facebook só recebe Reel pelo painel");
  const pageId = deps.pageId;
  if (!pageId) throw new PublicadorErro("META_PAGE_ID não configurado", { repetivel: true });
  const midias = listaMidias(post.midias);
  if (midias.length !== 1) throw new GraphErro("Reel leva exatamente 1 vídeo");

  // Etapas 1 e 2 não publicam nada: se falharem, dá para tentar de novo sem risco de duplicar.
  let videoId: string;
  let uploadUrl: string;
  try {
    const inicio = await chamarGraph(deps, "POST", `${pageId}/video_reels`, { upload_phase: "start" });
    videoId = typeof inicio.video_id === "string" ? inicio.video_id : "";
    if (!videoId) throw new GraphErro("Graph não devolveu video_id no início do Reel");
    uploadUrl =
      typeof inicio.upload_url === "string" && inicio.upload_url.startsWith("https://")
        ? inicio.upload_url
        : `https://rupload.facebook.com/video-upload/${deps.versao}/${videoId}`;
    await enviarPorUrl(deps, uploadUrl, midias[0]);
  } catch (e) {
    throw new GraphErro(semToken(e instanceof Error ? e.message : "Erro no envio do vídeo", deps.token), { repetivel: true });
  }

  await chamarGraph(deps, "POST", `${pageId}/video_reels`, {
    upload_phase: "finish",
    video_id: videoId,
    video_state: "PUBLISHED",
    description: post.legenda,
  });

  // Daqui em diante o Facebook já aceitou a publicação: nada abaixo pode virar "tente de novo".
  await esperarProcessar(deps, videoId);
  let permalink: string | null = null;
  try {
    const info = await chamarGraph(deps, "GET", videoId, { fields: "permalink_url" });
    const p = typeof info.permalink_url === "string" ? info.permalink_url : "";
    permalink = p ? (p.startsWith("http") ? p : `https://www.facebook.com${p.startsWith("/") ? "" : "/"}${p}`) : null;
  } catch {
    permalink = null; // já publicado; o link é só conveniência
  }
  return { situacao: "publicado", externoId: videoId, permalink };
}

async function enviarPorUrl(deps: PublicarDeps, uploadUrl: string, videoUrl: string): Promise<void> {
  let resposta: Response;
  try {
    resposta = await deps.fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `OAuth ${deps.token}`, file_url: videoUrl },
    });
  } catch (e) {
    throw new GraphErro(`Falha de rede no envio do vídeo: ${e instanceof Error ? e.message : "erro"}`);
  }
  let dados: Record<string, unknown> = {};
  try {
    dados = (await resposta.json()) as Record<string, unknown>;
  } catch {
    dados = {};
  }
  if (!resposta.ok || dados.error || dados.success === false) {
    const err = (dados.error ?? {}) as { message?: string };
    const debug = (dados.debug_info ?? {}) as { message?: string };
    throw new GraphErro(`Envio do vídeo ${resposta.status}: ${err.message ?? debug.message ?? "erro sem mensagem"}`);
  }
}

/** Espera o Facebook processar. Erro declarado vira falha; tempo esgotado segue como publicado (o finish foi aceito). */
async function esperarProcessar(deps: PublicarDeps, videoId: string): Promise<void> {
  const esperar = deps.esperar ?? esperaPadrao;
  const intervalo = deps.intervaloReelMs ?? 10_000;
  const tentativas = deps.tentativasReel ?? 30;
  for (let i = 0; i < tentativas; i++) {
    let dados: Record<string, unknown>;
    try {
      dados = await chamarGraph(deps, "GET", videoId, { fields: "status" });
    } catch {
      return; // não deu para consultar; o finish já foi aceito
    }
    const status = (dados.status ?? {}) as { video_status?: string; publishing_phase?: { status?: string } };
    if (status.video_status === "error" || status.publishing_phase?.status === "error") {
      throw new GraphErro("O Facebook recusou o vídeo depois do envio. Confira na Página antes de aprovar de novo.");
    }
    if (status.video_status === "ready" || status.publishing_phase?.status === "complete") return;
    await esperar(intervalo);
  }
}
