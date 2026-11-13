import { getCurrentWorkspaceId } from "@/lib/auth";
import { buscarFunil } from "@/lib/opi/leads-funil";

export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };

/**
 * GET /api/opi/funil — contagens de formulário e leads por material (sessão do painel).
 * Lê o webhook de leitura do n8n (OPI_FUNIL_URL + x-opi-secret) no servidor, com 8 s de limite e sem cache.
 * Só números: nome, telefone e e-mail de lead nunca passam por aqui.
 */
export async function GET() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) return Response.json({ error: "Não autenticado" }, { status: 401, headers: NO_STORE });

  const r = await buscarFunil();
  if (!r.ok) {
    return Response.json(
      {
        error: r.motivo === "nao_configurada" ? "Fonte de leads não configurada" : "Fonte de leads indisponível",
        motivo: r.motivo,
      },
      { status: 503, headers: NO_STORE },
    );
  }
  return Response.json({ data: r.dados }, { headers: NO_STORE });
}
