import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { autorizadoFreio, executarFreio } from "@/lib/opi/freio";

// Freio único da DM da OPI, chamado pelo bot do Telegram no n8n (/pausar_dm, /retomar_dm).
// Ver lib/opi/freio.ts e docs/opi-jev-gate.md.
const corpo = z.object({ acao: z.enum(["pausar", "retomar", "status"]) });

export async function POST(request: Request) {
  const auth = autorizadoFreio(request.headers.get("authorization"), process.env.OPI_FREIO_SECRET);
  if (auth === "sem_segredo") return Response.json({ error: "Freio não configurado" }, { status: 503 });
  if (auth === "negado") return Response.json({ error: "Unauthorized" }, { status: 401 });

  let acao: "pausar" | "retomar" | "status";
  try {
    acao = corpo.parse(await request.json()).acao;
  } catch {
    return Response.json({ error: "Use {\"acao\": \"pausar\" | \"retomar\" | \"status\"}" }, { status: 400 });
  }

  const workspaceId = process.env.OPI_FREIO_WORKSPACE_ID?.trim() || null;
  try {
    // Uma transação: ou desliga as campanhas E grava a lista, ou não muda nada (o bot então diz que não pausou).
    const data = await prisma.$transaction((tx) => executarFreio(tx, acao, workspaceId));
    return Response.json({ data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[OPI freio] falhou:", error instanceof Error ? error.name : "erro");
    return Response.json({ error: "Falha no freio" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
