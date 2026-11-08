import { NextRequest } from "next/server";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { inicioJanela, montarStatsCampanhas, periodoValido } from "@/lib/opi/campanhas-dados";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

// Gráficos de decisão da página Campanhas: só leitura, por workspace. ?dias=7|30|90 e ?instagramAccountId opcional.
export async function GET(request: NextRequest) {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const periodo = periodoValido(request.nextUrl.searchParams.get("dias"));
  const conta = request.nextUrl.searchParams.get("instagramAccountId")?.trim() || null;
  const agora = new Date();
  const filtroConta = conta && conta !== "all" ? { instagramAccountId: conta } : {};

  try {
    const [campanhas, logs, ultimos] = await Promise.all([
      prisma.automation.findMany({
        where: { workspaceId, ...filtroConta },
        select: { id: true, name: true, isActive: true, keywords: true, instagramAccount: { select: { username: true } } },
      }),
      prisma.dmLog.findMany({
        where: { workspaceId, ...filtroConta, createdAt: { gte: inicioJanela(agora, periodo) } },
        select: { automationId: true, status: true, createdAt: true, dmSentAt: true, publicReplySentAt: true },
        take: 50000,
      }),
      prisma.dmLog.groupBy({
        by: ["automationId"],
        where: { workspaceId, ...filtroConta, status: "SENT", dmSentAt: { not: null } },
        _max: { dmSentAt: true },
      }),
    ]);

    const dados = montarStatsCampanhas({
      agora,
      periodo,
      campanhas: campanhas.map((c) => ({
        id: c.id,
        name: c.name,
        isActive: c.isActive,
        keywords: c.keywords,
        username: c.instagramAccount?.username ?? null,
      })),
      logs,
      ultimosEnvios: Object.fromEntries(ultimos.map((u) => [u.automationId, u._max.dmSentAt ?? null])),
    });
    return Response.json({ success: true, data: dados }, { headers: NO_STORE });
  } catch (e) {
    console.error("[opi/campanhas-stats]", e);
    return Response.json({ success: false, error: "Falha ao montar os gráficos" }, { status: 500, headers: NO_STORE });
  }
}
