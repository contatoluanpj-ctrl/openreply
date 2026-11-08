import { NextResponse, type NextRequest } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { prisma } from "@/lib/db/client";
import { hashTemplate } from "@/lib/opi/jev-gate";
import { STATUS_SEM_DM, campanhaUsaPalavra, criarTextoSchema, motivoPausa } from "@/lib/opi/palavras";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}

// GET: textos aprovados do workspace, as campanhas que usam cada palavra (com o motivo da pausa) e os últimos
// comentários que ficaram sem DM.
export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [textos, automations, semDm] = await Promise.all([
    prisma.textoAprovado.findMany({ where: { workspaceId }, orderBy: { palavra: "asc" } }),
    prisma.automation.findMany({
      where: { workspaceId },
      select: { id: true, name: true, keywords: true, isActive: true, dmMessage: true, postId: true, postUrl: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.dmLog.findMany({
      where: { workspaceId, status: { in: [...STATUS_SEM_DM] } },
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        status: true,
        commenterName: true,
        commentText: true,
        matchedKeyword: true,
        errorMessage: true,
        jevReason: true,
        dmSentAt: true,
        publicReplySentAt: true,
        createdAt: true,
        automation: { select: { id: true, name: true } },
      },
    }),
  ]);

  // Motivo da pausa: só campanhas inativas precisam contar os envios do texto atual.
  const campanhas = await Promise.all(
    automations.map(async (a) => {
      const enviados = a.isActive
        ? 0
        : await prisma.dmLog.count({
            where: { automationId: a.id, status: "SENT", dmTemplateHash: hashTemplate(a.dmMessage) },
          });
      return {
        id: a.id,
        name: a.name,
        keywords: a.keywords,
        isActive: a.isActive,
        postUrl: a.postUrl,
        temPost: Boolean(a.postId),
        motivo: motivoPausa(a.isActive, enviados),
      };
    }),
  );

  const data = textos.map((t) => ({
    ...t,
    campanhas: campanhas.filter((c) => campanhaUsaPalavra(c.keywords, t.palavra)),
  }));

  return NextResponse.json({ data: { textos: data, semDm } }, { headers: NO_STORE });
}

// POST: novo texto aprovado. Só quem administra o workspace; aprovadoPor = usuário logado.
export async function POST(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(context.role)) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Corpo inválido" }, { status: 400 });
  }
  const parsed = criarTextoSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "Dados inválidos" }, { status: 400 });
  }

  try {
    const texto = await prisma.textoAprovado.create({
      data: { ...parsed.data, workspaceId: context.workspaceId, aprovadoPor: context.userId },
    });
    return NextResponse.json({ data: texto }, { status: 201 });
  } catch (e) {
    if (isUniqueViolation(e)) return NextResponse.json({ error: "Já existe um texto para essa palavra" }, { status: 409 });
    console.error("[OPI palavras] criar falhou:", e instanceof Error ? e.name : "erro");
    return NextResponse.json({ error: "Falha ao salvar" }, { status: 500 });
  }
}
