import { authenticateService, requireScope } from "@/lib/integrations/auth";
import { apiError, ApiError, checkOrigin, readJson } from "@/lib/integrations/http";
import { prisma } from "@/lib/db/client";
import { IngestErro, decidirIngest, ingestDecisaoSchema } from "@/lib/opi/ingest";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

/**
 * POST /api/opi/ingest/post/[id] { acao: "aprovar" | "descartar", selo, aprovadoPor? }
 * Chave de serviço com o escopo posts:aprovar. Só vale para rascunho que nasceu na esteira, e só se o selo
 * for o da prévia que o Luan viu. Aprovar não publica: o worker publica na hora marcada, como em todo post.
 */
export async function POST(request: Request, { params }: RouteProps) {
  try {
    checkOrigin(request);
    const context = await authenticateService(request);
    requireScope(context, "posts:aprovar");
    const { id } = await params;
    const parsed = ingestDecisaoSchema.safeParse(await readJson(request, 4 * 1024));
    if (!parsed.success) throw new ApiError("Use { acao, selo, aprovadoPor? }");
    try {
      const data = await decidirIngest(prisma, context.workspaceId, id, parsed.data);
      return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof IngestErro) throw new ApiError(e.message, e.status);
      throw e;
    }
  } catch (error) {
    return apiError(error);
  }
}
