import { z } from "zod";
import { authenticateService, requireScope } from "@/lib/integrations/auth";
import { apiError, ApiError, readJson } from "@/lib/integrations/http";
import { registrarResposta } from "@/lib/opi/pedidos";

export const dynamic = "force-dynamic";

const schema = z.object({
  status: z.enum(["FEITO", "ERRO"]),
  resposta: z.string().max(20000),
}).strict();

/** Runner local devolve a resposta de um pedido EM_ANDAMENTO (ServiceKey agentes:rw). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await authenticateService(request);
    requireScope(context, "agentes:rw");
    const { id } = await params;
    if (!z.string().min(1).max(100).safeParse(id).success) throw new ApiError("Id inválido");
    const input = schema.safeParse(await readJson(request, 128 * 1024));
    if (!input.success) throw new ApiError("Resposta inválida");
    const data = await registrarResposta(context.workspaceId, id, input.data);
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
