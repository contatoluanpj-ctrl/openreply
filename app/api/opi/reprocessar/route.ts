import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { prisma } from "@/lib/db/client";
import { getDMQueue } from "@/lib/queue/client";
import { jobIdDoComentario, motivoNaoReprocessar } from "@/lib/opi/palavras";

export const dynamic = "force-dynamic";

const corpo = z.object({ dmLogId: z.string().min(1) });

// POST { dmLogId }: o comentário que ficou sem DM (segurado, falhou ou pulado) volta para a fila. Remove o job antigo
// (mesmo jobId do webhook), apaga o DmLog e re-enfileira com os dados do webhook. O portão do Jev roda de novo:
// reprocessar não pula revisão nenhuma.
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  let dmLogId: string;
  try {
    dmLogId = corpo.parse(await request.json()).dmLogId;
  } catch {
    return NextResponse.json({ error: "Informe o dmLogId" }, { status: 400 });
  }

  const log = await prisma.dmLog.findFirst({
    where: { id: dmLogId, workspaceId: context.workspaceId },
    include: {
      automation: { select: { id: true, isActive: true, postId: true } },
      instagramAccount: { select: { id: true, instagramId: true } },
    },
  });
  if (!log) return NextResponse.json({ error: "Comentário não encontrado" }, { status: 404 });

  const recusa = motivoNaoReprocessar(log);
  if (recusa) return NextResponse.json({ error: recusa }, { status: 409 });
  // O DmLog não guarda o post; a campanha conforme está presa a um Reel (postId).
  if (!log.automation.postId) {
    return NextResponse.json({ error: "Campanha sem post definido; não dá para saber o Reel do comentário." }, { status: 409 });
  }
  if (!log.automation.isActive) {
    return NextResponse.json({ error: "A campanha está pausada. Reative a campanha antes de reprocessar." }, { status: 409 });
  }

  const jobId = jobIdDoComentario(log.instagramAccount.instagramId, log.commentId);
  const queue = getDMQueue();

  try {
    const job = await queue.getJob(jobId);
    if (job) {
      const estado = await job.getState();
      if (estado === "active") {
        return NextResponse.json({ error: "Esse comentário está sendo processado agora. Tente de novo em instantes." }, { status: 409 });
      }
      await job.remove();
    }
  } catch (e) {
    console.error("[OPI reprocessar] remover job falhou:", e instanceof Error ? e.name : "erro");
    return NextResponse.json({ error: "Não consegui tirar o job antigo da fila." }, { status: 409 });
  }

  // Sem o DmLog, o worker trata como comentário novo (tentativas zeradas).
  await prisma.dmLog.delete({ where: { id: log.id } });

  try {
    await queue.add(
      "process-comment",
      {
        instagramAccountId: log.instagramAccount.instagramId,
        accountConnectionId: log.instagramAccount.id,
        commentId: log.commentId,
        commentText: log.commentText,
        commenterId: log.commenterId,
        commenterName: log.commenterName ?? undefined,
        mediaId: log.automation.postId,
        // A janela de 7 dias (PARECER §8.2-3) continua valendo: o log nasceu quando o comentário chegou.
        commentTimestamp: log.createdAt.toISOString(),
        source: "WEBHOOK",
      },
      { jobId },
    );
  } catch (e) {
    console.error("[OPI reprocessar] enfileirar falhou:", e instanceof Error ? e.name : "erro");
    return NextResponse.json({ error: "O registro foi limpo, mas a fila recusou o job. Tente de novo pela reconciliação." }, { status: 500 });
  }

  return NextResponse.json({ data: { jobId } });
}
