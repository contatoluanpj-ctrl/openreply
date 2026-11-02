// Ligação do portão do Jev (lib/opi/jev-gate.ts) com o worker de DM: grava a decisão no DmLog e no JevLedger,
// avisa o Luan no Telegram e aplica a pausa da 1ª DM. Mantém a mudança em lib/queue/dm-worker.ts mínima.
import { prisma } from "@/lib/db/client";
import {
  avaliarComentario,
  avisarTelegram,
  gateLigado,
  linhasLedger,
  mensagemPausa,
  mensagemTelegram,
  pausaPrimeiraDmLigada,
  reservarPrimeiraDm,
  type FetchLike,
  type TelegramFetch,
} from "./jev-gate";

export type PortaoAutomation = {
  id: string;
  name: string;
  workspaceId: string;
  instagramAccountId: string;
  keywords: string[];
  matchAnyWord: boolean;
};

export type PortaoEntrada = {
  automation: PortaoAutomation;
  commentId: string; // id do comentário, ou "dm:<mid>" no gatilho por DM
  texto: string;
  commenterId: string;
  commenterName: string | null;
  matchedKeyword: string | null;
  origem: "comentário" | "DM";
  // DmLog já existente para (automation, commentId): reaproveita a decisão "enviar" sem chamar o Jev de novo.
  jevDecisionAnterior?: string | null;
  // false quando a DM já saiu e o job só tenta de novo a resposta pública: não há 1ª DM a pausar.
  precisaDm: boolean;
};

const fetchJev: FetchLike = (url, init) => fetch(url, init);
const fetchTelegram: TelegramFetch = (url, init) => fetch(url, init);

function logBase(e: PortaoEntrada) {
  return {
    workspaceId: e.automation.workspaceId,
    automationId: e.automation.id,
    instagramAccountId: e.automation.instagramAccountId,
    commenterId: e.commenterId,
    commenterName: e.commenterName,
    commentText: e.texto,
    commentId: e.commentId,
    matchedKeyword: e.matchedKeyword,
  };
}

async function segurar(e: PortaoEntrada, decisao: string, motivo: string, scores: Record<string, number | null> | null) {
  const campos = {
    status: "HELD_FOR_REVIEW" as const,
    jevDecision: decisao,
    jevReason: motivo.slice(0, 1000),
    ...(scores ? { jevScores: scores } : {}),
    errorMessage: `OPI: segurado para revisão (${decisao})`,
  };
  await prisma.dmLog.upsert({
    where: { automationId_commentId: { automationId: e.automation.id, commentId: e.commentId } },
    create: { ...logBase(e), ...campos },
    update: campos,
  });
  await avisarTelegram(
    mensagemTelegram({ campanha: e.automation.name, usuario: e.commenterName, texto: e.texto, decisao, motivo, origem: e.origem }),
    process.env,
    fetchTelegram,
  );
}

/**
 * Decide se este comentário/mensagem pode receber DM e resposta pública. true = liberado (o DmLog já leva a
 * decisão do Jev); false = segurado (DmLog em HELD_FOR_REVIEW, ledger gravado e Luan avisado).
 * Com OPI_JEV_GATE=off devolve true sem fazer nada.
 */
export async function aplicarPortaoJev(e: PortaoEntrada): Promise<boolean> {
  if (!gateLigado()) return true;

  if (e.jevDecisionAnterior !== "enviar") {
    const a = await avaliarComentario({
      texto: e.texto,
      palavrasChave: e.automation.keywords,
      matchAnyWord: e.automation.matchAnyWord,
      apiKey: process.env.TYPESAFE_API_KEY,
      fetchImpl: fetchJev,
    });
    await prisma.jevLedger.createMany({
      data: linhasLedger(a, {
        workspaceId: e.automation.workspaceId,
        automationId: e.automation.id,
        commentId: e.commentId,
        texto: e.texto,
      }),
    });
    if (a.decisao !== "enviar") {
      await segurar(e, a.decisao, a.motivo, a.p);
      return false;
    }
    const campos = { jevDecision: a.decisao, jevReason: a.motivo, jevScores: a.p };
    await prisma.dmLog.upsert({
      where: { automationId_commentId: { automationId: e.automation.id, commentId: e.commentId } },
      create: { ...logBase(e), status: "PENDING", ...campos },
      update: campos,
    });
  }

  if (e.precisaDm && pausaPrimeiraDmLigada()) {
    const r = await reservarPrimeiraDm(prisma, e.automation.id);
    if (r === "pausada") {
      await segurar(e, "campanha_pausada", "campanha pausada após a 1ª DM (PARECER §8.2-4); reative para liberar", null);
      return false;
    }
    if (r === "primeira") {
      await avisarTelegram(mensagemPausa({ campanha: e.automation.name, usuario: e.commenterName }), process.env, fetchTelegram);
    }
  }
  return true;
}
