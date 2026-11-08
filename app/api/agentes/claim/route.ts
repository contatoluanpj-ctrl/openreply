import { authenticateService, requireScope } from "@/lib/integrations/auth";
import { apiError } from "@/lib/integrations/http";
import { claimProximoPedido } from "@/lib/opi/pedidos";

export const dynamic = "force-dynamic";

/** Runner local: pega o próximo pedido NOVO (ServiceKey com escopo agentes:rw). */
export async function POST(request: Request) {
  try {
    const context = await authenticateService(request);
    requireScope(context, "agentes:rw");
    const pedido = await claimProximoPedido(context.workspaceId);
    const data = pedido && {
      id: pedido.id, agente: pedido.agente, mensagem: pedido.mensagem,
      status: pedido.status, createdAt: pedido.createdAt,
    };
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiError(error); }
}
