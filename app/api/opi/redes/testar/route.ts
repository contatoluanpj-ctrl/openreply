import { NextResponse } from "next/server";
import { z } from "zod";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { coletarRedes } from "@/lib/opi/redes-coleta";
import { REDES_TESTAVEIS } from "@/lib/opi/redes-teste";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" };

const corpoSchema = z.object({ redes: z.array(z.enum(REDES_TESTAVEIS)).min(1).max(REDES_TESTAVEIS.length).optional() }).strict();

/**
 * POST /api/opi/redes/testar { redes? } — testa AGORA a conexão de cada rede (só leitura) e grava o
 * resultado como RedeSnapshot. Nada é publicado. Só quem administra o workspace.
 */
export async function POST(request: Request) {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401, headers: NO_STORE });
  if (!canManageWorkspace(ctx.role)) return NextResponse.json({ error: "Sem permissão" }, { status: 403, headers: NO_STORE });

  const bruto = await request.json().catch(() => ({}));
  const parsed = corpoSchema.safeParse(bruto ?? {});
  if (!parsed.success) return NextResponse.json({ error: "Dados inválidos" }, { status: 400, headers: NO_STORE });

  try {
    const resultados = await coletarRedes(ctx.workspaceId, { redes: parsed.data.redes });
    return NextResponse.json(
      {
        testadoEm: new Date().toISOString(),
        // _autor e afins ficam só no banco: a tela recebe o que é para mostrar.
        resultados: resultados.map((r) => ({
          rede: r.rede,
          ok: r.ok,
          conta: r.conta,
          detalhe: r.detalhe,
          semConfiguracao: r.semConfiguracao,
        })),
      },
      { headers: NO_STORE },
    );
  } catch {
    return NextResponse.json({ error: "Não foi possível testar as redes agora" }, { status: 500, headers: NO_STORE });
  }
}
