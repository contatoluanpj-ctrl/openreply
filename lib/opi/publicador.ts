import { prisma } from "@/lib/db/client";
import { getMetaGraphApiVersion } from "@/lib/env";
import { resolvePageAccessToken } from "@/lib/meta/facebook-login";
import { facebookInstagramUserId, facebookPageAccessToken, facebookPageId } from "@/lib/meta/login-mode";
import { alertarFalha } from "@/lib/opi/alertas";
import { temAviso } from "@/lib/opi/aviso";
import { PREFIXO_ALVO, filtroSemAlvo } from "@/lib/opi/campanha-alvo";
import {
  MAX_TENTATIVAS,
  REDES_COMPOSIO,
  REDES_META,
  destinoElegivel,
  filtroDestinoElegivel,
  nomeRede,
  ordenarDestinos,
  resumoDoPost,
  type DestinoLinha,
} from "@/lib/opi/destinos";
import { publicarDestino } from "@/lib/opi/publicadores";
import { COMPOSIO_NAO_CONFIGURADO, composioConfig, semChave } from "@/lib/opi/publicadores/composio";
import { semToken, type PublicarDeps } from "@/lib/opi/publicadores/graph";
import type { ResultadoPublicacao } from "@/lib/opi/publicadores/instagram";
import { PublicadorErro } from "@/lib/opi/publicadores/tipos";

/**
 * Publicador do calendário do OPI Central.
 *
 * Só publica PostAgendado aprovado pelo Luan na tela (D-0026) e com o aviso obrigatório na legenda.
 * Fica desligado até OPI_PUBLICADOR=on OU até a chave "Publicação automática" ser ligada no Calendário
 * (Workspace.opiPublicadorLigado). A chave do painel vale só para o workspace dono da conta do Instagram
 * que publica.
 *
 * Cada post tem um destino por rede (PostDestino). A rodada publica destino a destino, pelos publicadores
 * de lib/opi/publicadores: a falha de uma rede não impede as outras, cada falha avisa o Luan, e um destino
 * PUBLICADO nunca é publicado de novo. PostAgendado.status segue como resumo (lib/opi/destinos.ts).
 */

// Compatibilidade: o publicador do Instagram morava aqui.
export { publicarPost, type ResultadoPublicacao } from "@/lib/opi/publicadores/instagram";
export { GraphErro, type PublicarDeps } from "@/lib/opi/publicadores/graph";
export type { PostParaPublicar } from "@/lib/opi/publicadores/tipos";

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
  /** Destinos publicados nesta rodada. */
  publicados: number;
  /** Destinos que falharam (e posts barrados pelo aviso obrigatório). */
  erros: number;
  /** Destinos pulados (rede não recebe o tipo) e posts/destinos que outra rodada já tinha travado. */
  pulados: number;
};

type Env = Record<string, string | undefined>;

/** Dependências injetáveis nos testes: as da Graph e o ambiente lido pelos publicadores do Composio. */
export type DepsRodada = Partial<PublicarDeps> & { env?: Env };

type DestinoDaRodada = DestinoLinha & { titulo?: string | null; descricao?: string | null };

type PostDaRodada = {
  id: string;
  workspaceId: string;
  tipo: "CARROSSEL" | "REEL" | "POST";
  midias: unknown;
  legenda: string;
  agendadoPara: Date;
  status: string;
  destinos?: DestinoDaRodada[];
};

let rodando = false;

/**
 * Uma rodada do publicador (o worker chama a cada minuto).
 *
 * 1. Pega os posts aprovados com agendadoPara <= agora que ainda têm destino por sair.
 * 2. Post APROVADO é travado com updateMany APROVADO -> PUBLICANDO (só segue se count === 1); assim a tela
 *    não deixa editar nem apagar no meio da publicação.
 * 3. Cada destino é travado com updateMany PENDENTE -> PUBLICANDO (só segue se count === 1) e publicado
 *    na rede dele. Falha em uma rede não interrompe as outras.
 * 4. O status do post é regravado como resumo dos destinos.
 */
export async function rodarPublicador(agora: Date = new Date(), depsTeste?: DepsRodada): Promise<ResumoRodada> {
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

    const env = depsTeste?.env ?? process.env;
    const composio = composioConfig(env);
    const limiteTravado = new Date(agora.getTime() - PUBLICANDO_TRAVADO_MS);

    // Post que ficou em PUBLICANDO (worker caiu no meio) vira ERRO para o Luan conferir.
    // Não volta para APROVADO sozinho, para nunca publicar duas vezes.
    const travados = await prisma.postAgendado.updateMany({
      where: { ...filtroWorkspace, status: "PUBLICANDO", updatedAt: { lt: limiteTravado } },
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
    // O mesmo para o destino que ficou em PUBLICANDO: vira ERRO e só volta com nova aprovação.
    const destinosTravados = await prisma.postDestino.updateMany({
      where: { status: "PUBLICANDO", updatedAt: { lt: limiteTravado }, post: filtroWorkspace },
      data: { status: "ERRO", erro: "Publicação interrompida. Confira na rede antes de tentar de novo." },
    });
    if ((destinosTravados?.count ?? 0) > 0) {
      await alertarFalha(
        "post",
        `${destinosTravados.count} destino(s) com a publicação interrompida. Confira na rede antes de tentar de novo.`,
        LINK_CALENDARIO,
        { chave: "destino:interrompido" },
      );
    }

    const postsNoPrazo = { ...filtroWorkspace, aprovadoEm: { not: null }, agendadoPara: { lte: agora } };

    // Sem a chave do Composio, YouTube, LinkedIn e X ficam PENDENTE com o motivo escrito no destino.
    // Não entram na fila da rodada (não gastam tentativa) e não geram alerta.
    if (!composio) {
      await prisma.postDestino.updateMany({
        where: {
          status: "PENDENTE",
          rede: { in: [...REDES_COMPOSIO] },
          OR: [{ erro: null }, { erro: { not: COMPOSIO_NAO_CONFIGURADO } }],
          post: { ...postsNoPrazo, status: { in: ["APROVADO", "PUBLICADO"] } },
        },
        data: { erro: COMPOSIO_NAO_CONFIGURADO },
      });
    }

    const elegivel = filtroDestinoElegivel(composio !== null);
    const pendentes = (await prisma.postAgendado.findMany({
      where: {
        ...postsNoPrazo,
        OR: [
          // Aprovado antes de existirem destinos (ou por script): ganha o destino instagram na hora.
          { status: "APROVADO", destinos: { none: {} } },
          // Aprovado que ainda não saiu, ou já publicado no Instagram com outra rede por sair.
          { status: { in: ["APROVADO", "PUBLICADO"] }, destinos: { some: elegivel } },
          // Aprovado de novo por fora da tela (script) com o destino instagram já resolvido:
          // se já saiu, só acerta o resumo; se tinha falhado, a nova aprovação devolve o destino para a fila.
          { status: "APROVADO", destinos: { some: { rede: "instagram", status: { in: ["PUBLICADO", "ERRO", "PULADO"] } } } },
        ],
      },
      orderBy: [{ agendadoPara: "asc" }, { id: "asc" }],
      take: LIMITE_POR_RODADA,
      include: { destinos: true },
    })) as unknown as PostDaRodada[];
    if (pendentes.length === 0) return resumo;

    // Token da Página e ids da Meta: usados pelo Instagram e pelo Facebook.
    let graph: PublicarDeps | null = null;
    try {
      graph = {
        fetch: depsTeste?.fetch ?? fetch,
        token: depsTeste?.token ?? (await resolvePageAccessToken(facebookPageAccessToken())),
        igUserId: depsTeste?.igUserId ?? facebookInstagramUserId(),
        versao: depsTeste?.versao ?? getMetaGraphApiVersion(),
        pageId: depsTeste?.pageId ?? pageIdOpcional(),
        esperar: depsTeste?.esperar,
        intervaloReelMs: depsTeste?.intervaloReelMs,
        tentativasReel: depsTeste?.tentativasReel,
      };
    } catch {
      console.error("[OPI Publicador] Configuração da Meta ausente (META_PAGE_ACCESS_TOKEN, META_PAGE_ID, META_IG_USER_ID)");
    }
    const contexto = { graph, fetch: depsTeste?.fetch ?? fetch, env };
    const limpar = (texto: string) => semChave(semToken(texto, graph?.token ?? ""), composio?.apiKey ?? "");

    for (const post of pendentes) {
      // Confere de novo, post a post, que o workspace dele está liberado nesta rodada.
      if (!todos && !resumo.workspaces.includes(post.workspaceId)) {
        resumo.pulados++;
        continue;
      }
      const eraAprovado = post.status === "APROVADO";
      let destinos: DestinoDaRodada[] = ordenarDestinos(post.destinos ?? []);
      if (destinos.length === 0) {
        if (!eraAprovado) continue;
        const criado = await prisma.postDestino.upsert({
          where: { postId_rede: { postId: post.id, rede: "instagram" } },
          create: { postId: post.id, rede: "instagram" },
          update: {},
        });
        destinos = [criado as unknown as DestinoDaRodada];
      }

      // Post APROVADO com o destino instagram em ERRO só existe quando alguém aprovou de novo por fora da tela
      // (a rodada sempre grava ERRO no post quando o Instagram falha). Aprovação nova = tentativa nova, como na tela.
      // Vale só para o Instagram, que é quem define o resumo; as outras redes voltam pela tela ("tentar de novo").
      const igParado = eraAprovado ? destinos.find((d) => d.rede === "instagram" && (d.status === "ERRO" || d.status === "PULADO")) : undefined;
      if (igParado) {
        const solto = await prisma.postDestino.updateMany({
          where: { id: igParado.id, status: { in: ["ERRO", "PULADO"] } },
          data: { status: "PENDENTE", erro: null, tentativas: 0 },
        });
        if (solto.count === 1) Object.assign(igParado, { status: "PENDENTE", erro: null, tentativas: 0 });
      }

      // Sem a configuração da Meta, Instagram e Facebook esperam (como antes: nada é travado).
      const candidatos = destinos.filter(
        (d) => destinoElegivel(d, composio !== null) && (graph !== null || !(REDES_META as readonly string[]).includes(d.rede)),
      );
      if (candidatos.length === 0) {
        // Nada a publicar. Se o resumo já não é "aprovado" (ex.: Instagram já saiu), acerta o status do post.
        const r = resumoDoPost(destinos);
        if (eraAprovado && r.status !== "APROVADO") {
          await prisma.postAgendado.updateMany({ where: { id: post.id, status: "APROVADO" }, data: r });
        }
        continue;
      }

      if (eraAprovado) {
        const trava = await prisma.postAgendado.updateMany({
          where: { id: post.id, status: "APROVADO" },
          data: { status: "PUBLICANDO", erro: null },
        });
        if (trava.count !== 1) {
          resumo.pulados++;
          continue;
        }
      }

      if (!temAviso(post.legenda)) {
        const erro = "Legenda sem o aviso obrigatório. Nada foi publicado.";
        if (eraAprovado) {
          await prisma.postAgendado.update({ where: { id: post.id }, data: { status: "ERRO", erro } });
        } else {
          await prisma.postDestino.updateMany({
            where: { id: { in: candidatos.map((d) => d.id) }, status: "PENDENTE" },
            data: { status: "ERRO", erro },
          });
        }
        resumo.erros++;
        await alertarFalha("post", `${rotuloPost(post)}: legenda sem o aviso obrigatório. Nada foi publicado.`, LINK_CALENDARIO, {
          chave: `post:${post.id}`,
          workspaceId: post.workspaceId,
        });
        continue;
      }

      for (const destino of candidatos) {
        const feitas = (destino.tentativas ?? 0) + 1;
        // Trava do destino: só uma rodada leva PENDENTE -> PUBLICANDO. PUBLICADO nunca volta para a fila.
        const trava = await prisma.postDestino.updateMany({
          where: { id: destino.id, status: "PENDENTE" },
          data: { status: "PUBLICANDO", erro: null, tentativas: { increment: 1 } },
        });
        if (trava.count !== 1) {
          resumo.pulados++;
          continue;
        }
        try {
          const r = await publicarDestino(post, destino, contexto);
          if (r.situacao === "publicado") {
            await prisma.postDestino.update({
              where: { id: destino.id },
              data: { status: "PUBLICADO", externoId: r.externoId, permalink: r.permalink, erro: null, publicadoEm: new Date() },
            });
            Object.assign(destino, { status: "PUBLICADO", externoId: r.externoId, permalink: r.permalink, erro: null });
            resumo.publicados++;
            if (destino.rede === "instagram" && post.tipo === "REEL") {
              await prenderCampanhasAoReel(post, { mediaId: r.externoId, permalink: r.permalink });
            }
          } else if (r.situacao === "pulado") {
            await prisma.postDestino.update({ where: { id: destino.id }, data: { status: "PULADO", erro: r.motivo } });
            Object.assign(destino, { status: "PULADO", erro: r.motivo });
            resumo.pulados++;
          } else {
            // Falta configuração ou aprovação: volta a esperar, sem gastar tentativa e sem alerta.
            await prisma.postDestino.update({
              where: { id: destino.id },
              data: { status: "PENDENTE", erro: r.motivo, tentativas: { decrement: 1 } },
            });
            Object.assign(destino, { status: "PENDENTE", erro: r.motivo });
          }
        } catch (e) {
          const msg = limpar(e instanceof Error ? e.message : "Erro desconhecido");
          // Só tenta de novo sozinho quando é certo que nada saiu, e até o limite de tentativas.
          const repetir = e instanceof PublicadorErro && e.repetivel && feitas < MAX_TENTATIVAS;
          const status = repetir ? "PENDENTE" : "ERRO";
          await prisma.postDestino.update({ where: { id: destino.id }, data: { status, erro: msg } });
          Object.assign(destino, { status, erro: msg, tentativas: feitas });
          console.error("[OPI Publicador] Falha ao publicar", post.id, destino.rede, msg);
          resumo.erros++;
          const noInstagram = destino.rede === "instagram";
          await alertarFalha(
            "post",
            noInstagram ? `${rotuloPost(post)}: ${msg}` : `${rotuloPost(post)} no ${nomeRede(destino.rede)}: ${msg}`,
            LINK_CALENDARIO,
            { chave: noInstagram ? `post:${post.id}` : `post:${post.id}:${destino.rede}`, workspaceId: post.workspaceId },
          );
        }
      }

      // Resumo do post. Só o post que esta rodada travou (APROVADO -> PUBLICANDO) precisa ser regravado.
      if (eraAprovado) {
        await prisma.postAgendado.update({ where: { id: post.id }, data: resumoDoPost(destinos) });
      }
    }
    return resumo;
  } finally {
    rodando = false;
  }
}

function pageIdOpcional(): string | undefined {
  try {
    return facebookPageId();
  } catch {
    return undefined;
  }
}
