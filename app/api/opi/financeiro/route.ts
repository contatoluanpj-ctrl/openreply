import { NextRequest } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import {
  TIPOS,
  filtroMes,
  lancamentoSchema,
  mesAtual,
  mesValido,
  porMes,
  resumo,
  serializar,
  ultimosMeses,
  type Tipo,
} from "@/lib/opi/financeiro";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// Financeiro do OPI Central: lançamentos de controle interno. Nada aqui gasta dinheiro nem mexe em Ads.
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const mes = request.nextUrl.searchParams.get("mes")?.trim() || null;
  const tipoTxt = request.nextUrl.searchParams.get("tipo")?.trim().toUpperCase() || null;

  if (mes && !mesValido(mes)) {
    return Response.json({ error: "Mês inválido (use AAAA-MM)" }, { status: 400 });
  }
  if (tipoTxt && !(TIPOS as readonly string[]).includes(tipoTxt)) {
    return Response.json({ error: "Tipo inválido (RECEITA ou DESPESA)" }, { status: 400 });
  }
  const tipo = (tipoTxt as Tipo | null) ?? undefined;

  // O gráfico cobre os 6 meses que terminam no mês filtrado (ou no mês atual), respeitando o tipo.
  const meses = ultimosMeses(mes ?? mesAtual(), 6);
  const janela = { gte: filtroMes(meses[0]).gte, lt: filtroMes(meses[meses.length - 1]).lt };

  const [lancamentos, historico] = await Promise.all([
    prisma.lancamento.findMany({
      where: { workspaceId, ...(tipo ? { tipo } : {}), ...(mes ? { data: filtroMes(mes) } : {}) },
      orderBy: [{ data: "desc" }, { createdAt: "desc" }],
      take: 500,
    }),
    prisma.lancamento.findMany({
      where: { workspaceId, ...(tipo ? { tipo } : {}), data: janela },
      select: { data: true, tipo: true, valor: true },
    }),
  ]);

  return Response.json(
    {
      data: lancamentos.map(serializar),
      resumo: resumo(lancamentos),
      porMes: porMes(historico, meses),
    },
    { headers: NO_STORE }
  );
}

export async function POST(request: NextRequest) {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (!canManageWorkspace(ctx.role)) {
    return Response.json({ error: "Sem permissão para editar o financeiro" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "JSON inválido" }, { status: 400 });
  }
  const parsed = lancamentoSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  const criado = await prisma.lancamento.create({
    data: { ...parsed.data, workspaceId: ctx.workspaceId },
  });
  return Response.json({ data: serializar(criado) }, { status: 201, headers: NO_STORE });
}
