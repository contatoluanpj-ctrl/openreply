import { prisma } from "@/lib/db/client";
import { ApiError } from "@/lib/integrations/http";

const MAX_TENTATIVAS = 3;

/**
 * Pega o pedido NOVO mais antigo do workspace e o marca EM_ANDAMENTO.
 * O updateMany com `status: "NOVO"` no where é o trinco atômico: se outro runner pegou antes,
 * count volta 0 e tentamos o próximo.
 */
export async function claimProximoPedido(workspaceId: string) {
  for (let tentativa = 0; tentativa < MAX_TENTATIVAS; tentativa++) {
    const candidato = await prisma.pedidoAgente.findFirst({
      where: { workspaceId, status: "NOVO" },
      orderBy: { createdAt: "asc" },
    });
    if (!candidato) return null;
    const iniciadoEm = new Date();
    const result = await prisma.pedidoAgente.updateMany({
      where: { id: candidato.id, workspaceId, status: "NOVO" },
      data: { status: "EM_ANDAMENTO", iniciadoEm },
    });
    if (result.count === 1) {
      return { ...candidato, status: "EM_ANDAMENTO" as const, iniciadoEm };
    }
  }
  return null;
}

export async function registrarResposta(
  workspaceId: string,
  id: string,
  input: { status: "FEITO" | "ERRO"; resposta: string },
) {
  const result = await prisma.pedidoAgente.updateMany({
    where: { id, workspaceId, status: "EM_ANDAMENTO" },
    data: { status: input.status, resposta: input.resposta, concluidoEm: new Date() },
  });
  if (result.count === 0) throw new ApiError("Pedido não encontrado ou não está em andamento", 409);
  return { id, status: input.status };
}
