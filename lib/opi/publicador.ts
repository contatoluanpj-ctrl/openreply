import { prisma } from "@/lib/db/client";
import { getMetaGraphApiVersion } from "@/lib/env";
import { resolvePageAccessToken } from "@/lib/meta/facebook-login";
import { facebookInstagramUserId, facebookPageAccessToken } from "@/lib/meta/login-mode";
import { temAviso } from "@/lib/opi/aviso";

/**
 * Publicador do calendário do OPI Central.
 *
 * Só publica PostAgendado com status APROVADO (aprovado pelo Luan na tela, D-0026)
 * e com o aviso obrigatório na legenda. Fica desligado até OPI_PUBLICADOR=on.
 * Usa a Graph API (Facebook Login for Business) com o token da Página.
 */

export type PostParaPublicar = {
  id: string;
  tipo: "CARROSSEL" | "REEL" | "POST";
  midias: unknown;
  legenda: string;
};

export type PublicarDeps = {
  fetch: typeof fetch;
  token: string;
  igUserId: string;
  versao: string;
  /** Espera entre consultas do status do Reel. Injetável nos testes. */
  esperar?: (ms: number) => Promise<void>;
  /** Intervalo e limite da espera do Reel. Padrão: 10 s, 30 tentativas (~5 min). */
  intervaloReelMs?: number;
  tentativasReel?: number;
};

export type ResultadoPublicacao = { mediaId: string; permalink: string | null };

export class GraphErro extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphErro";
  }
}

const esperaPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function semToken(texto: string, token: string): string {
  let t = texto;
  if (token) t = t.split(token).join("[token]");
  return t.replace(/access_token=[^&\s"]+/g, "access_token=[token]").slice(0, 300);
}

async function chamarGraph(
  deps: PublicarDeps,
  metodo: "GET" | "POST",
  caminho: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const base = `https://graph.facebook.com/${deps.versao}/${caminho}`;
  let resposta: Response;
  try {
    if (metodo === "GET") {
      const url = new URL(base);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      url.searchParams.set("access_token", deps.token);
      resposta = await deps.fetch(url.toString());
    } else {
      const corpo = new URLSearchParams({ ...params, access_token: deps.token });
      resposta = await deps.fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: corpo.toString(),
      });
    }
  } catch (e) {
    throw new GraphErro(semToken(`Falha de rede na Graph: ${e instanceof Error ? e.message : "erro"}`, deps.token));
  }
  let dados: Record<string, unknown> = {};
  try {
    dados = (await resposta.json()) as Record<string, unknown>;
  } catch {
    dados = {};
  }
  if (!resposta.ok || dados.error) {
    const err = (dados.error ?? {}) as { message?: string; code?: number };
    const msg = `Graph ${resposta.status}${err.code ? ` (código ${err.code})` : ""}: ${err.message ?? "erro sem mensagem"}`;
    throw new GraphErro(semToken(msg, deps.token));
  }
  return dados;
}

function idDe(dados: Record<string, unknown>, etapa: string): string {
  const id = dados.id;
  if (typeof id !== "string" || !id) throw new GraphErro(`Graph não devolveu id em ${etapa}`);
  return id;
}

function listaMidias(midias: unknown): string[] {
  if (!Array.isArray(midias)) return [];
  return midias.filter((m): m is string => typeof m === "string" && m.startsWith("https://"));
}

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

export function publicadorLigado(): boolean {
  return (process.env.OPI_PUBLICADOR ?? "").trim().toLowerCase() === "on";
}

const LIMITE_POR_RODADA = 5;
const PUBLICANDO_TRAVADO_MS = 30 * 60_000;

export type ResumoRodada = {
  ligado: boolean;
  publicados: number;
  erros: number;
  pulados: number;
};

let rodando = false;

/**
 * Uma rodada do publicador (o worker chama a cada minuto).
 * Pega APROVADO com agendadoPara <= agora, trava cada um com updateMany
 * APROVADO -> PUBLICANDO (só segue se count === 1), publica e grava o resultado.
 */
export async function rodarPublicador(
  agora: Date = new Date(),
  depsTeste?: Partial<PublicarDeps>,
): Promise<ResumoRodada> {
  const resumo: ResumoRodada = { ligado: publicadorLigado(), publicados: 0, erros: 0, pulados: 0 };
  if (!resumo.ligado || rodando) return resumo;
  rodando = true;
  try {
    // Post que ficou em PUBLICANDO (worker caiu no meio) vira ERRO para o Luan conferir.
    // Não volta para APROVADO sozinho, para nunca publicar duas vezes.
    await prisma.postAgendado.updateMany({
      where: { status: "PUBLICANDO", updatedAt: { lt: new Date(agora.getTime() - PUBLICANDO_TRAVADO_MS) } },
      data: { status: "ERRO", erro: "Publicação interrompida. Confira no Instagram antes de aprovar de novo." },
    });

    const pendentes = await prisma.postAgendado.findMany({
      where: { status: "APROVADO", aprovadoEm: { not: null }, agendadoPara: { lte: agora } },
      orderBy: { agendadoPara: "asc" },
      take: LIMITE_POR_RODADA,
    });
    if (pendentes.length === 0) return resumo;

    let deps: PublicarDeps;
    try {
      deps = {
        fetch: depsTeste?.fetch ?? fetch,
        token: depsTeste?.token ?? (await resolvePageAccessToken(facebookPageAccessToken())),
        igUserId: depsTeste?.igUserId ?? facebookInstagramUserId(),
        versao: depsTeste?.versao ?? getMetaGraphApiVersion(),
        esperar: depsTeste?.esperar,
        intervaloReelMs: depsTeste?.intervaloReelMs,
        tentativasReel: depsTeste?.tentativasReel,
      };
    } catch {
      console.error("[OPI Publicador] Configuração da Meta ausente (META_PAGE_ACCESS_TOKEN, META_PAGE_ID, META_IG_USER_ID)");
      return resumo;
    }

    for (const post of pendentes) {
      const trava = await prisma.postAgendado.updateMany({
        where: { id: post.id, status: "APROVADO" },
        data: { status: "PUBLICANDO", erro: null },
      });
      if (trava.count !== 1) {
        resumo.pulados++;
        continue;
      }
      if (!temAviso(post.legenda)) {
        await prisma.postAgendado.update({
          where: { id: post.id },
          data: { status: "ERRO", erro: "Legenda sem o aviso obrigatório. Nada foi publicado." },
        });
        resumo.erros++;
        continue;
      }
      try {
        const r = await publicarPost(post, deps);
        await prisma.postAgendado.update({
          where: { id: post.id },
          data: { status: "PUBLICADO", mediaId: r.mediaId, permalink: r.permalink, erro: null },
        });
        resumo.publicados++;
      } catch (e) {
        const msg = semToken(e instanceof Error ? e.message : "Erro desconhecido", deps.token);
        await prisma.postAgendado.update({ where: { id: post.id }, data: { status: "ERRO", erro: msg } });
        console.error("[OPI Publicador] Falha ao publicar", post.id, msg);
        resumo.erros++;
      }
    }
    return resumo;
  } finally {
    rodando = false;
  }
}
