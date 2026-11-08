import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { apiError, ApiError, checkOrigin, readJson } from "@/lib/integrations/http";
import { isAgenteId } from "@/lib/opi/agentes";
import {
  LEDGER_AUTOMACAO,
  PERGUNTA_RESPONSAVEL,
  hashPedido,
  mensagemParaAgente,
  sugerirRota,
} from "@/lib/opi/roteador";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

const campos = {
  id: true, agente: true, mensagem: true, status: true, resposta: true, anexos: true,
  createdAt: true, updatedAt: true,
} as const;

async function contexto() {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) throw new ApiError("Não autenticado", 401);
  if (!canManageWorkspace(ctx.role)) throw new ApiError("Permissão de administrador necessária", 403);
  return ctx;
}

/** GET → últimos pedidos enviados pelo chat central (agrupados pelo cliente via anexos.grupo). */
export async function GET() {
  try {
    const ctx = await contexto();
    const pedidos = await prisma.pedidoAgente.findMany({
      where: { workspaceId: ctx.workspaceId, anexos: { path: ["origem"], equals: "chat" } },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: campos,
    });
    return Response.json({ data: pedidos.reverse() }, { headers: noStore });
  } catch (error) { return apiError(error); }
}

const sugerirSchema = z.object({ acao: z.literal("sugerir"), mensagem: z.string().trim().min(1).max(4000) }).strict();
const enviarSchema = z.object({
  acao: z.literal("enviar"),
  mensagem: z.string().trim().min(1).max(4000),
  destinos: z.array(z.string().refine(isAgenteId)).min(1).max(5),
  sugeridos: z.array(z.string()).max(5).optional(),
  ledgerId: z.string().max(40).optional(),
}).strict();

/**
 * POST {acao:"sugerir", mensagem} → o Jev sugere o responsável (grava no JevLedger).
 * POST {acao:"enviar", mensagem, destinos} → cria um pedido para cada destino e registra a escolha final do Luan.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const ctx = await contexto();
    const corpo = await readJson(request);

    const sug = sugerirSchema.safeParse(corpo);
    if (sug.success) {
      const chave = process.env.TYPESAFE_API_KEY ?? "";
      const sugestao = chave ? await sugerirRota(sug.data.mensagem, chave) : null;
      let ledgerId: string | null = null;
      try {
        const reg = await prisma.jevLedger.create({
          data: {
            workspaceId: ctx.workspaceId,
            automationId: LEDGER_AUTOMACAO,
            commentId: hashPedido(sug.data.mensagem),
            pergunta: PERGUNTA_RESPONSAVEL.id,
            versao: PERGUNTA_RESPONSAVEL.version,
            p: sugestao?.ranking[0]?.p ?? null,
            erro: sugestao ? null : chave ? "jev sem resposta" : "TYPESAFE_API_KEY ausente",
            decisao: sugestao ? sugestao.destinos.join("+") : "manual",
            entradaHash: hashPedido(sug.data.mensagem),
          },
          select: { id: true },
        });
        ledgerId = reg.id;
      } catch {
        ledgerId = null; // o ledger não pode travar o chat
      }
      return Response.json({ data: { sugestao, ledgerId } }, { headers: noStore });
    }

    const env = enviarSchema.safeParse(corpo);
    if (!env.success) throw new ApiError("Pedido inválido");
    const { mensagem, destinos, sugeridos, ledgerId } = env.data;
    const unicos = [...new Set(destinos)];
    const grupo = hashPedido(`${mensagem}|${Date.now()}`);
    const criados = await prisma.$transaction(
      unicos.map((agente) =>
        prisma.pedidoAgente.create({
          data: {
            workspaceId: ctx.workspaceId,
            agente,
            mensagem: mensagemParaAgente(mensagem, agente, unicos),
            anexos: { origem: "chat", grupo, pedidoOriginal: mensagem },
          },
          select: campos,
        }),
      ),
    );
    if (ledgerId) {
      const manteve = !!sugeridos && sugeridos.length === unicos.length && sugeridos.every((s) => unicos.includes(s));
      await prisma.jevLedger
        .updateMany({
          where: { id: ledgerId, workspaceId: ctx.workspaceId, automationId: LEDGER_AUTOMACAO },
          data: { finalLuan: manteve, resultadoReal: unicos.join("+") },
        })
        .catch(() => undefined);
    }
    return Response.json({ data: criados }, { status: 201, headers: noStore });
  } catch (error) { return apiError(error); }
}
