import { NextRequest } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { filtroMes, mesAtual, mesValido } from "@/lib/opi/financeiro";
import { montarPainel } from "@/lib/opi/financeiro-dados";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// Gráficos do Financeiro: 12 meses que terminam em ?mes (ou no mês atual). Só leitura.
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const mes = request.nextUrl.searchParams.get("mes")?.trim() || mesAtual();
  if (!mesValido(mes)) {
    return Response.json({ error: "Mês inválido (use AAAA-MM)" }, { status: 400 });
  }

  // Tudo até o fim do mês de referência: o saldo acumulado precisa do que veio antes da janela.
  const lancamentos = await prisma.lancamento.findMany({
    where: { workspaceId, data: { lt: filtroMes(mes).lt } },
    select: { data: true, tipo: true, valor: true, status: true, categoria: true },
    orderBy: { data: "asc" },
    take: 5000,
  });

  return Response.json({ data: montarPainel(lancamentos, mes, 12) }, { headers: NO_STORE });
}
