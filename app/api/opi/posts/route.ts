import { NextResponse } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { SELECT_DESTINO, paraDestinosView } from "@/lib/opi/destinos";
import { mesIntervalo, mesValido, postRascunhoSchema } from "@/lib/opi/posts-schema";

export const dynamic = "force-dynamic";

/** GET /api/opi/posts?mes=AAAA-MM — posts do calendário do mês (fuso de São Paulo), com os destinos de cada um. */
export async function GET(request: Request) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const mes = new URL(request.url).searchParams.get("mes");
  if (!mesValido(mes)) return NextResponse.json({ error: "Use mes=AAAA-MM" }, { status: 400 });
  const { inicio, fim } = mesIntervalo(mes);

  const posts = await prisma.postAgendado.findMany({
    where: { workspaceId, agendadoPara: { gte: inicio, lt: fim } },
    orderBy: [{ agendadoPara: "asc" }, { id: "asc" }],
    include: { destinos: { select: SELECT_DESTINO } },
  });
  // Cada post leva os destinos (uma rede cada), com status e link, na ordem fixa das redes.
  return NextResponse.json({ posts: posts.map((p) => ({ ...p, destinos: paraDestinosView(p.destinos) })) });
}

/** POST /api/opi/posts — cria um RASCUNHO. Nada é publicado sem aprovação do mês. */
export async function POST(request: Request) {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!canManageWorkspace(ctx.role)) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const corpo = await request.json().catch(() => null);
  const parsed = postRascunhoSchema.safeParse(corpo);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { tipo, midias, legenda, agendadoPara } = parsed.data;
  const post = await prisma.postAgendado.create({
    data: {
      workspaceId: ctx.workspaceId,
      tipo,
      midias,
      legenda,
      agendadoPara: new Date(agendadoPara),
      status: "RASCUNHO",
    },
  });
  return NextResponse.json({ post }, { status: 201 });
}
