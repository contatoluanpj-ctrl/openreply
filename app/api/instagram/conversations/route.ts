import { NextRequest, NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { getWorkspaceInstagramAccount } from "@/lib/instagram-accounts";
import { createInstagramContext, getConversations, sendDirectMessage } from "@/lib/instagram/provider";
import {
  ERRO_SEM_CONTA,
  erroInbox,
  modoInbox,
  montarConversas,
  type ConversationListItem,
  type ModoInbox,
} from "@/lib/instagram/inbox";

export type { ConversationListItem } from "@/lib/instagram/inbox";

export const dynamic = "force-dynamic";

export interface ConversationsResponse {
  conversations: ConversationListItem[];
  account: { id: string; username: string; instagramId: string };
  modo: ModoInbox;
}

function falha(erro: { status: number; codigo: string; mensagem: string }) {
  return NextResponse.json(
    { success: false, error: erro.mensagem, codigo: erro.codigo },
    { status: erro.status }
  );
}

// Lista as conversas de DM da conta para a Caixa de entrada (Login do Facebook ou do Instagram).
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Sessão expirada. Entre de novo.", codigo: "sessao" },
      { status: 401 }
    );
  }

  const account = await getWorkspaceInstagramAccount(
    workspaceId,
    request.nextUrl.searchParams.get("instagramAccountId")
  );
  if (!account) return falha(ERRO_SEM_CONTA);

  try {
    const context = await createInstagramContext(account);
    const raw = await getConversations({ context, igUserId: account.instagramId });
    const data: ConversationsResponse = {
      conversations: montarConversas(raw, account.instagramId),
      account: { id: account.id, username: account.username, instagramId: account.instagramId },
      modo: modoInbox(account.provider),
    };
    return NextResponse.json({ success: true, data });
  } catch (err) {
    const erro = erroInbox(err, "carregar as conversas");
    console.error("[Inbox] Falha ao listar conversas:", erro.codigo, err instanceof Error ? err.name : "erro");
    return falha(erro);
  }
}

// Responde uma DM (sujeito à janela de 24 horas do Instagram).
export async function POST(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) {
    return NextResponse.json(
      { success: false, error: "Sessão expirada. Entre de novo.", codigo: "sessao" },
      { status: 401 }
    );
  }

  let body: { instagramAccountId?: string; recipientId?: string; text?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ success: false, error: "Pedido inválido." }, { status: 400 });
  }

  const text = body.text?.trim();
  if (!body.recipientId || !text) {
    return NextResponse.json(
      { success: false, error: "Escolha a conversa e escreva a mensagem." },
      { status: 400 }
    );
  }

  const account = await getWorkspaceInstagramAccount(workspaceId, body.instagramAccountId ?? null);
  if (!account) return falha(ERRO_SEM_CONTA);

  try {
    const context = await createInstagramContext(account);
    const result = await sendDirectMessage({
      context,
      instagramAccountId: account.instagramId,
      userId: body.recipientId,
      message: text,
    });
    return NextResponse.json({ success: true, data: result });
  } catch (err) {
    // O caso comum é a janela de 24 horas fechada: a mensagem da Meta vai junto para o Luan ver.
    const erro = erroInbox(err, "enviar a mensagem");
    console.error("[Inbox] Falha ao enviar:", erro.codigo, err instanceof Error ? err.name : "erro");
    return falha(erro);
  }
}
