import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export const dynamic = "force-dynamic";

export type EstadoPublicador = {
  /** Chave "Publicação automática" do workspace. */
  ligado: boolean;
  alteradoEm: string | null;
  alteradoPor: string | null;
  /** O workspace tem a conta do Instagram que publica (META_IG_USER_ID)? Sem ela a chave não publica nada. */
  contaConectada: boolean;
  podeAlterar: boolean;
};

async function contaDoPublicador(workspaceId: string): Promise<boolean> {
  const igUserId = (process.env.META_IG_USER_ID ?? "").trim();
  const conta = await prisma.instagramAccount.findFirst({
    where: igUserId ? { workspaceId, instagramId: igUserId } : { workspaceId },
    select: { id: true },
  });
  return !!conta;
}

/** GET /api/opi/publicador: estado da chave da publicação automática do workspace atual. */
export async function GET() {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const [ws, contaConectada] = await Promise.all([
    prisma.workspace.findUnique({
      where: { id: ctx.workspaceId },
      select: { opiPublicadorLigado: true, opiPublicadorAlteradoEm: true, opiPublicadorAlteradoPor: true },
    }),
    contaDoPublicador(ctx.workspaceId),
  ]);
  const estado: EstadoPublicador = {
    ligado: ws?.opiPublicadorLigado ?? false,
    alteradoEm: ws?.opiPublicadorAlteradoEm?.toISOString() ?? null,
    alteradoPor: ws?.opiPublicadorAlteradoPor ?? null,
    contaConectada,
    podeAlterar: canManageWorkspace(ctx.role),
  };
  return NextResponse.json(estado);
}

/**
 * PATCH /api/opi/publicador { ligado: boolean }
 * Liga ou desliga a publicação automática deste workspace. Só muda a chave: o publicador continua
 * publicando apenas post APROVADO (calendário aprovado pelo Luan, D-0026) e com o aviso na legenda.
 */
export async function PATCH(request: Request) {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!canManageWorkspace(ctx.role)) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const corpo = (await request.json().catch(() => null)) as { ligado?: unknown } | null;
  if (typeof corpo?.ligado !== "boolean") {
    return NextResponse.json({ error: "Envie { ligado: true } ou { ligado: false }" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true, name: true } });
  const ws = await prisma.workspace.update({
    where: { id: ctx.workspaceId },
    data: {
      opiPublicadorLigado: corpo.ligado,
      opiPublicadorAlteradoEm: new Date(),
      opiPublicadorAlteradoPor: user?.name ?? user?.email ?? ctx.userId,
    },
    select: { opiPublicadorLigado: true, opiPublicadorAlteradoEm: true, opiPublicadorAlteradoPor: true },
  });
  const estado: EstadoPublicador = {
    ligado: ws.opiPublicadorLigado,
    alteradoEm: ws.opiPublicadorAlteradoEm?.toISOString() ?? null,
    alteradoPor: ws.opiPublicadorAlteradoPor ?? null,
    contaConectada: await contaDoPublicador(ctx.workspaceId),
    podeAlterar: true,
  };
  return NextResponse.json(estado);
}
