import { authenticateService, requireScope } from "@/lib/integrations/auth";
import { apiError, ApiError, checkOrigin, readJson } from "@/lib/integrations/http";
import { prisma } from "@/lib/db/client";
import { snapshotSchema } from "@/lib/opi/redes";

export const dynamic = "force-dynamic";

/**
 * POST /api/opi/redes/snapshot — agente (ServiceKey com escopo redes:write) grava as métricas
 * de uma rede. O workspace vem só da chave; workspaceId no corpo é rejeitado (400).
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const context = await authenticateService(request);
    requireScope(context, "redes:write");
    const parsed = snapshotSchema.safeParse(await readJson(request, 16 * 1024));
    if (!parsed.success) throw new ApiError(`Corpo inválido: ${parsed.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}`);
    const { rede, estado, metricas, coletadoEm } = parsed.data;
    const row = await prisma.redeSnapshot.create({
      data: {
        workspaceId: context.workspaceId,
        rede,
        estado,
        metricas,
        ...(coletadoEm ? { coletadoEm: new Date(coletadoEm) } : {}),
      },
      select: { id: true, rede: true, estado: true, coletadoEm: true },
    });
    return Response.json({ data: row }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
