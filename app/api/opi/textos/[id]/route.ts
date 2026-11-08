import { NextResponse, type NextRequest } from "next/server";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { prisma } from "@/lib/db/client";
import { editarTextoSchema } from "@/lib/opi/palavras";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

type Contexto =
  | { ok: true; context: { userId: string; workspaceId: string } }
  | { ok: false; erro: NextResponse };

async function contexto(): Promise<Contexto> {
  const context = await getCurrentWorkspaceContext();
  if (!context) return { ok: false, erro: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  if (!canManageWorkspace(context.role)) return { ok: false, erro: NextResponse.json({ error: "Sem permissão" }, { status: 403 }) };
  return { ok: true, context };
}

// PATCH: edita palavra, DM, resposta pública ou ativo. Fora do workspace = 404.
export async function PATCH(request: NextRequest, { params }: Params) {
  const c = await contexto();
  if (!c.ok) return c.erro;
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido" }, { status: 400 });
  }
  const parsed = editarTextoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }

  const atual = await prisma.textoAprovado.findFirst({ where: { id, workspaceId: c.context.workspaceId } });
  if (!atual) return NextResponse.json({ error: "Texto não encontrado" }, { status: 404 });

  try {
    // Mudar o texto é uma nova aprovação: registra quem aprovou.
    const mudouTexto = parsed.data.dmMessage !== undefined || parsed.data.palavra !== undefined;
    const texto = await prisma.textoAprovado.update({
      where: { id: atual.id },
      data: { ...parsed.data, ...(mudouTexto ? { aprovadoPor: c.context.userId } : {}) },
    });
    return NextResponse.json({ data: texto });
  } catch (e) {
    if (isUniqueViolation(e)) return NextResponse.json({ error: "Já existe um texto para essa palavra" }, { status: 409 });
    console.error("[OPI palavras] editar falhou:", e instanceof Error ? e.name : "erro");
    return NextResponse.json({ error: "Falha ao salvar" }, { status: 500 });
  }
}

// DELETE: apaga o texto. O portão deixa de aceitá-lo na hora (campanhas com ele ficam bloqueadas).
export async function DELETE(_request: NextRequest, { params }: Params) {
  const c = await contexto();
  if (!c.ok) return c.erro;
  const { id } = await params;

  const r = await prisma.textoAprovado.deleteMany({ where: { id, workspaceId: c.context.workspaceId } });
  if (r.count === 0) return NextResponse.json({ error: "Texto não encontrado" }, { status: 404 });
  return NextResponse.json({ data: { id } });
}
