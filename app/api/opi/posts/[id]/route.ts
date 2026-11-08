import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { postRascunhoSchema } from "@/lib/opi/posts-schema";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/** Status que ainda aceitam edição. Editar um APROVADO devolve para RASCUNHO (D-0026). */
const EDITAVEIS = ["RASCUNHO", "APROVADO", "ERRO"] as const;

type Contexto = NonNullable<Awaited<ReturnType<typeof getCurrentWorkspaceContext>>>;

async function contextoEscrita(): Promise<{ erro: Response } | { ctx: Contexto }> {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) return { erro: NextResponse.json({ error: "Não autenticado" }, { status: 401 }) };
  if (!canManageWorkspace(ctx.role)) {
    return { erro: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  }
  return { ctx };
}

async function respostaSemAlteracao(id: string, workspaceId: string, acao: string) {
  const existe = await prisma.postAgendado.findFirst({
    where: { id, workspaceId },
    select: { status: true },
  });
  if (!existe) return NextResponse.json({ error: "Post não encontrado" }, { status: 404 });
  return NextResponse.json(
    { error: `Post em publicação ou já publicado não pode ser ${acao}` },
    { status: 409 },
  );
}

/** PATCH /api/opi/posts/[id] — edita o post. Qualquer edição volta para RASCUNHO e limpa a aprovação. */
export async function PATCH(request: Request, { params }: RouteProps) {
  const r = await contextoEscrita();
  if ("erro" in r) return r.erro;
  const { id } = await params;

  const corpo = await request.json().catch(() => null);
  const parsed = postRascunhoSchema.safeParse(corpo);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { tipo, midias, legenda, agendadoPara } = parsed.data;

  const resultado = await prisma.postAgendado.updateMany({
    where: { id, workspaceId: r.ctx.workspaceId, status: { in: [...EDITAVEIS] } },
    data: {
      tipo,
      midias,
      legenda,
      agendadoPara: new Date(agendadoPara),
      status: "RASCUNHO",
      aprovadoEm: null,
      aprovadoPor: null,
      erro: null,
    },
  });
  if (resultado.count === 0) return respostaSemAlteracao(id, r.ctx.workspaceId, "editado");
  const post = await prisma.postAgendado.findFirst({ where: { id, workspaceId: r.ctx.workspaceId } });
  return NextResponse.json({ post });
}

/** DELETE /api/opi/posts/[id] — apaga o post, exceto em publicação ou já publicado. */
export async function DELETE(_request: Request, { params }: RouteProps) {
  const r = await contextoEscrita();
  if ("erro" in r) return r.erro;
  const { id } = await params;

  const resultado = await prisma.postAgendado.deleteMany({
    where: { id, workspaceId: r.ctx.workspaceId, status: { in: [...EDITAVEIS] } },
  });
  if (resultado.count === 0) return respostaSemAlteracao(id, r.ctx.workspaceId, "apagado");
  return NextResponse.json({ ok: true });
}
