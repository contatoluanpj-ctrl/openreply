import { NextRequest } from "next/server";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { lancamentoPatchSchema, serializar } from "@/lib/opi/financeiro";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

type Params = { params: Promise<{ id: string }> };

async function autorizar() {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(ctx.role)) {
    return Response.json({ error: "Sem permissão para editar o financeiro" }, { status: 403 });
  }
  return ctx;
}

async function doWorkspace(id: string, workspaceId: string) {
  return prisma.lancamento.findFirst({ where: { id, workspaceId }, select: { id: true } });
}

export async function PATCH(request: NextRequest, { params }: Params) {
  const ctx = await autorizar();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = lancamentoPatchSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  if (!(await doWorkspace(id, ctx.workspaceId))) {
    return Response.json({ error: "Lançamento não encontrado" }, { status: 404 });
  }
  const atualizado = await prisma.lancamento.update({ where: { id }, data: parsed.data });
  return Response.json({ data: serializar(atualizado) }, { headers: NO_STORE });
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const ctx = await autorizar();
  if (ctx instanceof Response) return ctx;
  const { id } = await params;

  if (!(await doWorkspace(id, ctx.workspaceId))) {
    return Response.json({ error: "Lançamento não encontrado" }, { status: 404 });
  }
  await prisma.lancamento.delete({ where: { id } });
  return Response.json({ data: { id } }, { headers: NO_STORE });
}
