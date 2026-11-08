import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { montarRedes } from "@/lib/opi/redes";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/** GET /api/opi/redes — as 9 redes com o último snapshot de cada uma (sessão do painel). */
export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return Response.json({ error: "Não autenticado" }, { status: 401, headers: NO_STORE });
  try {
    const [snapshots, ig] = await Promise.all([
      prisma.redeSnapshot.findMany({
        where: { workspaceId },
        orderBy: { coletadoEm: "desc" },
        distinct: ["rede"],
        select: { rede: true, estado: true, metricas: true, coletadoEm: true },
      }),
      prisma.followerSnapshot.findFirst({
        where: { instagramAccount: { workspaceId } },
        orderBy: { date: "desc" },
        select: { followersCount: true, date: true },
      }),
    ]);
    return Response.json({ data: montarRedes(snapshots, ig) }, { headers: NO_STORE });
  } catch {
    return Response.json({ error: "Erro ao carregar as redes" }, { status: 500, headers: NO_STORE });
  }
}
