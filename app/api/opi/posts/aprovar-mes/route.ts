import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { temAviso } from "@/lib/opi/aviso";
import { prepararDestinosNaAprovacao } from "@/lib/opi/destinos";
import { mesIntervalo, mesValido } from "@/lib/opi/posts-schema";

export const dynamic = "force-dynamic";

type Pendencia = { id: string; agendadoPara: Date; motivo: string };

/**
 * POST /api/opi/posts/aprovar-mes { mes: "AAAA-MM" }
 * Aprova de uma vez todos os RASCUNHO do mês (D-0026). Tudo ou nada: se algum
 * rascunho estiver sem o aviso obrigatório ou com data já passada, nada é aprovado.
 * Cria os destinos de cada post (PostDestino) e devolve para a fila os que tinham falhado.
 */
export async function POST(request: Request) {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!canManageWorkspace(ctx.role)) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });

  const corpo = (await request.json().catch(() => null)) as { mes?: string } | null;
  const mes = corpo?.mes;
  if (!mesValido(mes)) return NextResponse.json({ error: "Use mes=AAAA-MM" }, { status: 400 });
  const { inicio, fim } = mesIntervalo(mes);

  const rascunhos = await prisma.postAgendado.findMany({
    where: { workspaceId: ctx.workspaceId, status: "RASCUNHO", agendadoPara: { gte: inicio, lt: fim } },
    orderBy: { agendadoPara: "asc" },
    select: { id: true, tipo: true, legenda: true, agendadoPara: true },
  });
  if (rascunhos.length === 0) {
    return NextResponse.json({ error: "Nenhum rascunho neste mês" }, { status: 400 });
  }

  const agora = Date.now();
  const pendencias: Pendencia[] = [];
  for (const p of rascunhos) {
    if (!temAviso(p.legenda)) {
      pendencias.push({ id: p.id, agendadoPara: p.agendadoPara, motivo: "Legenda sem o aviso obrigatório" });
    } else if (p.agendadoPara.getTime() <= agora) {
      pendencias.push({ id: p.id, agendadoPara: p.agendadoPara, motivo: "Data e hora já passaram" });
    }
  }
  if (pendencias.length > 0) {
    return NextResponse.json(
      { error: "Calendário não aprovado. Corrija os itens e tente de novo.", pendencias },
      { status: 422 },
    );
  }

  const usuario = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } });
  const aprovadoPor = usuario?.email ?? ctx.userId;
  const aprovadoEm = new Date();

  // Destinos antes da aprovação: destino de post ainda em RASCUNHO não é publicado, então a ordem é segura,
  // e o post nunca fica aprovado sem ter para onde ir. Reel segue OPI_DESTINOS_PADRAO; o resto, só Instagram.
  await prepararDestinosNaAprovacao(prisma, rascunhos);

  const resultado = await prisma.postAgendado.updateMany({
    where: { id: { in: rascunhos.map((p) => p.id) }, workspaceId: ctx.workspaceId, status: "RASCUNHO" },
    data: { status: "APROVADO", aprovadoEm, aprovadoPor },
  });
  return NextResponse.json({ aprovados: resultado.count, aprovadoEm, aprovadoPor });
}
