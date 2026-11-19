import { authenticateService, requireScope } from "@/lib/integrations/auth";
import { apiError, ApiError, checkOrigin, readJson } from "@/lib/integrations/http";
import { prisma } from "@/lib/db/client";
import { IngestErro, criarRascunhoIngest, ingestPostSchema } from "@/lib/opi/ingest";

export const dynamic = "force-dynamic";

/**
 * POST /api/opi/ingest/post — chave de serviço com o escopo posts:rascunho.
 * A esteira de vídeo cria aqui o RASCUNHO de um Reel já editado. Nada é aprovado nem publicado:
 * a resposta traz o selo que a aprovação (POST /api/opi/ingest/post/[id]) vai exigir depois do "sim" do Luan.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const context = await authenticateService(request);
    requireScope(context, "posts:rascunho");
    const parsed = ingestPostSchema.safeParse(await readJson(request, 16 * 1024));
    if (!parsed.success) {
      throw new ApiError(`Corpo inválido: ${parsed.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}`);
    }
    try {
      const data = await criarRascunhoIngest(prisma, context.workspaceId, parsed.data);
      return Response.json({ data }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (e) {
      if (e instanceof IngestErro) throw new ApiError(e.message, e.status);
      throw e;
    }
  } catch (error) {
    return apiError(error);
  }
}
