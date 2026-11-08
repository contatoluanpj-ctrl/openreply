import { z } from "zod";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { apiError, ApiError, checkOrigin, readJson } from "@/lib/integrations/http";
import { AGENTES_CHAT, estaAtivo, isAgenteChat } from "@/lib/opi/agentes";

export const dynamic = "force-dynamic";

const noStore = { "Cache-Control": "no-store" };
const campos = {
  id: true, agente: true, mensagem: true, status: true, resposta: true,
  iniciadoEm: true, concluidoEm: true, createdAt: true, updatedAt: true,
} as const;

/** GET ?agente=x → últimas 50 mensagens (ordem cronológica). Sem agente → resumo para o mapa. */
export async function GET(request: Request) {
  try {
    const workspaceId = await getCurrentWorkspaceId();
    if (!workspaceId) throw new ApiError("Não autenticado", 401);
    const agente = new URL(request.url).searchParams.get("agente");
    if (agente !== null) {
      if (!isAgenteChat(agente)) throw new ApiError("Agente inválido");
      const pedidos = await prisma.pedidoAgente.findMany({
        where: { workspaceId, agente }, orderBy: { createdAt: "desc" }, take: 50, select: campos,
      });
      return Response.json({ data: pedidos.reverse() }, { headers: noStore });
    }
    const recentes = await prisma.pedidoAgente.findMany({
      where: { workspaceId }, orderBy: { updatedAt: "desc" }, take: 200,
      select: { agente: true, status: true, updatedAt: true },
    });
    const agora = new Date();
    const data = AGENTES_CHAT.map((id) => {
      const doAgente = recentes.filter((p) => p.agente === id);
      return { agente: id, ativo: estaAtivo(doAgente, agora), ultimo: doAgente[0]?.updatedAt ?? null };
    });
    return Response.json({ data }, { headers: noStore });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const context = await getCurrentWorkspaceContext();
    if (!context) throw new ApiError("Não autenticado", 401);
    if (!canManageWorkspace(context.role)) throw new ApiError("Permissão de administrador necessária", 403);
    const input = z.object({
      agente: z.enum(AGENTES_CHAT),
      mensagem: z.string().trim().min(1).max(4000),
    }).strict().safeParse(await readJson(request));
    if (!input.success) throw new ApiError("Pedido inválido");
    const pedido = await prisma.pedidoAgente.create({
      data: { workspaceId: context.workspaceId, agente: input.data.agente, mensagem: input.data.mensagem },
      select: campos,
    });
    return Response.json({ data: pedido }, { status: 201, headers: noStore });
  } catch (error) { return apiError(error); }
}
