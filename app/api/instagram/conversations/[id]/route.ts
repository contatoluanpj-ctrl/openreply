import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { createInstagramContext, getConversationMessages } from "@/lib/instagram/provider";
import { ERRO_SEM_CONTA, erroInbox, montarMensagens, type ThreadMessage } from "@/lib/instagram/inbox";

export type { ThreadMessage } from "@/lib/instagram/inbox";

export const dynamic = "force-dynamic";

export interface ThreadResponse {
  messages: ThreadMessage[];
}

type RouteProps = { params: Promise<{ id: string }> };

// Mensagens de uma conversa (a Meta só detalha as 20 mais recentes), em ordem cronológica.
export async function GET(request: NextRequest, { params }: RouteProps) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Sessão expirada. Entre de novo.", codigo: "sessao" },
      { status: 401 }
    );
  }

  const { id: conversationId } = await params;
  const account = await getWorkspaceInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!account) {
    return NextResponse.json(
      { success: false, error: ERRO_SEM_CONTA.mensagem, codigo: ERRO_SEM_CONTA.codigo },
      { status: ERRO_SEM_CONTA.status }
    );
  }

  try {
    const context = await createInstagramContext(account);
    const raw = await getConversationMessages({ context, conversationId });
    const data: ThreadResponse = { messages: montarMensagens(raw, account.instagramId) };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    const erro = erroInbox(err, "carregar as mensagens");
    console.error("[Inbox] Falha ao abrir conversa:", erro.codigo, err instanceof Error ? err.name : "erro");
    return NextResponse.json({ success: false, error: erro.mensagem, codigo: erro.codigo }, { status: erro.status });
  }
}
