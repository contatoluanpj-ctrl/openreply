import { prisma } from "@/lib/db/client";
import { getMetaGraphApiVersion } from "@/lib/env";
import { resolvePageAccessToken } from "@/lib/meta/facebook-login";
import { facebookInstagramUserId, facebookPageAccessToken } from "@/lib/meta/login-mode";
import { alertarFalha } from "@/lib/opi/alertas";
import { temAviso } from "@/lib/opi/aviso";
import { PREFIXO_ALVO, filtroSemAlvo } from "@/lib/opi/campanha-alvo";

/**
 * Publicador do calendário do OPI Central.
 *
 * Só publica PostAgendado com status APROVADO (aprovado pelo Luan na tela, D-0026)
 * e com o aviso obrigatório na legenda. Fica desligado até OPI_PUBLICADOR=on OU até a
 * chave "Publicação automática" ser ligada no Calendário (Workspace.opiPublicadorLigado).
 * A chave do painel vale só para o workspace dono da conta do Instagram que publica.
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

/** OPI_PUBLICADOR=on no ambiente do worker: liga para todos os workspaces (modo antigo). */
export function publicadorLigadoEnv(): boolean {
  return (process.env.OPI_PUBLICADOR ?? "").trim().toLowerCase() === "on";
}

/** Ligado se o ambiente estiver on OU se a chave do workspace estiver ligada no painel. */
export function publicadorLigado(chaveWorkspace = false): boolean {
  return publicadorLigadoEnv() || chaveWorkspace === true;
}

const LIMITE_POR_RODADA = 5;

/**
 * Campanha "próximo Reel" (pendingNextReel) do mesmo workspace passa a valer na hora em que o Reel sai,
 * sem esperar a busca de 5 min do worker: comentário dos primeiros minutos já casa com a campanha.
 * Falha aqui não desfaz a publicação (o worker prende de novo na próxima busca).
 */
async function prenderCampanhasAoReel(post: { id?: string; workspaceId?: string }, r: ResultadoPublicacao): Promise<void> {
  if (!post.workspaceId) return;
  const data = { postId: r.mediaId, postUrl: r.permalink, pendingNextReel: false };
  try {
    // Campanha com alvo neste post agendado ("agendado:<id>").
    if (post.id) {
      await prisma.automation.updateMany({
        where: { workspaceId: post.workspaceId, pendingNextReel: true, postUrl: PREFIXO_ALVO + post.id },
        data,
      });
    }
    // Campanha "próximo Reel" sem alvo.
    await prisma.automation.updateMany({
      where: { workspaceId: post.workspaceId, pendingNextReel: true, ...filtroSemAlvo },
      data,
    });
  } catch (e) {
    console.error("[OPI Publicador] Reel publicado, mas a campanha não foi presa agora", e instanceof Error ? e.message : e);
  }
}
const PUBLICANDO_TRAVADO_MS = 30 * 60_000;
const LINK_CALENDARIO = "/dashboard/calendario";

const fmtHoraPost = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function rotuloPost(post: { tipo: string; agendadoPara?: Date | null }): string {
  const tipo = post.tipo === "REEL" ? "Reel" : post.tipo === "CARROSSEL" ? "Carrossel" : "Post";
  return post.agendadoPara instanceof Date ? `${tipo} de ${fmtHoraPost.format(post.agendadoPara)}` : tipo;
}

export type ResumoRodada = {
  ligado: boolean;
  /** Workspaces com a chave do painel ligada nesta rodada (vazio quando vale o OPI_PUBLICADOR=on). */
  workspaces: string[];
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
  const resumo: ResumoRodada = { ligado: false, workspaces: [], publicados: 0, erros: 0, pulados: 0 };
  if (rodando) return resumo;
  rodando = true;
  try {
    // Quem pode publicar nesta rodada: todos (env on) ou só os workspaces com a chave ligada
    // no painel E donos da conta do Instagram que vai publicar (o token da Página é global).
    const todos = publicadorLigadoEnv();
    let filtroWorkspace: { workspaceId?: { in: string[] } } = {};
    if (!todos) {
      let igUserId: string;
      try {
        igUserId = depsTeste?.igUserId ?? facebookInstagramUserId();
      } catch {
        return resumo; // sem META_IG_USER_ID não há conta para publicar
      }
      const ligados = await prisma.workspace.findMany({
        where: { opiPublicadorLigado: true, instagramAccounts: { some: { instagramId: igUserId } } },
        select: { id: true },
      });
      resumo.workspaces = ligados.map((w) => w.id);
      if (resumo.workspaces.length === 0) return resumo;
      filtroWorkspace = { workspaceId: { in: resumo.workspaces } };
    }
    resumo.ligado = true;

    // Post que ficou em PUBLICANDO (worker caiu no meio) vira ERRO para o Luan conferir.
    // Não volta para APROVADO sozinho, para nunca publicar duas vezes.
    const travados = await prisma.postAgendado.updateMany({
      where: {
        ...filtroWorkspace,
        status: "PUBLICANDO",
        updatedAt: { lt: new Date(agora.getTime() - PUBLICANDO_TRAVADO_MS) },
      },
      data: { status: "ERRO", erro: "Publicação interrompida. Confira no Instagram antes de aprovar de novo." },
    });
    if ((travados?.count ?? 0) > 0) {
      await alertarFalha(
        "post",
        `${travados.count} post(s) com a publicação interrompida. Confira no Instagram antes de aprovar de novo.`,
        LINK_CALENDARIO,
        { chave: "post:interrompido" },
      );
    }

    const pendentes = await prisma.postAgendado.findMany({
      where: { ...filtroWorkspace, status: "APROVADO", aprovadoEm: { not: null }, agendadoPara: { lte: agora } },
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
      // Confere de novo, post a post, que o workspace dele está liberado nesta rodada.
      if (!todos && !resumo.workspaces.includes(post.workspaceId)) {
        resumo.pulados++;
        continue;
      }
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
        await alertarFalha("post", `${rotuloPost(post)}: legenda sem o aviso obrigatório. Nada foi publicado.`, LINK_CALENDARIO, {
          chave: `post:${post.id}`,
          workspaceId: post.workspaceId,
        });
        continue;
      }
      try {
        const r = await publicarPost(post, deps);
        await prisma.postAgendado.update({
          where: { id: post.id },
          data: { status: "PUBLICADO", mediaId: r.mediaId, permalink: r.permalink, erro: null },
        });
        resumo.publicados++;
        if (post.tipo === "REEL") await prenderCampanhasAoReel(post, r);
      } catch (e) {
        const msg = semToken(e instanceof Error ? e.message : "Erro desconhecido", deps.token);
        await prisma.postAgendado.update({ where: { id: post.id }, data: { status: "ERRO", erro: msg } });
        console.error("[OPI Publicador] Falha ao publicar", post.id, msg);
        resumo.erros++;
        await alertarFalha("post", `${rotuloPost(post)}: ${msg}`, LINK_CALENDARIO, {
          chave: `post:${post.id}`,
          workspaceId: post.workspaceId,
        });
      }
    }
    return resumo;
  } finally {
    rodando = false;
  }
}
