import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { AVISO_OBRIGATORIO } from "@/lib/opi/aviso";
import { composioConfig, semChave } from "@/lib/opi/publicadores/composio";
import { publicarReelFacebook } from "@/lib/opi/publicadores/facebook";
import { semToken } from "@/lib/opi/publicadores/graph";
import { listaMidias, type PostParaPublicar } from "@/lib/opi/publicadores/tipos";
import { publicarYoutube } from "@/lib/opi/publicadores/youtube";
import { graphDoAmbiente } from "@/lib/opi/redes-coleta";

export const dynamic = "force-dynamic";
// O vídeo é baixado e reenviado dentro da função: precisa de folga.
export const maxDuration = 300;

const NO_STORE = { "Cache-Control": "no-store" };
const corpoSchema = z.object({ rede: z.enum(["youtube", "facebook"]) }).strict();

const TITULO_TESTE = "Teste técnico OPI (privado, pode apagar)";
const TEXTO_TESTE = `Envio de teste do painel OPI Central. Pode apagar.\n\n${AVISO_OBRIGATORIO}`;

/**
 * POST /api/opi/redes/teste-publicacao { rede } — prova o caminho de publicação de ponta a ponta SEM
 * publicar para o público:
 *   youtube  -> sobe o vídeo como PRIVADO (só o dono do canal vê), com título de teste;
 *   facebook -> sobe o Reel como RASCUNHO da Página.
 * Usa o vídeo do Reel mais recente do calendário. Não cria nem altera post, destino ou aprovação.
 */
export async function POST(request: Request) {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401, headers: NO_STORE });
  if (!canManageWorkspace(ctx.role)) return NextResponse.json({ error: "Sem permissão" }, { status: 403, headers: NO_STORE });

  const parsed = corpoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Informe a rede: youtube ou facebook" }, { status: 400, headers: NO_STORE });
  const { rede } = parsed.data;

  const reels = await prisma.postAgendado.findMany({
    where: { workspaceId: ctx.workspaceId, tipo: "REEL" },
    orderBy: { agendadoPara: "desc" },
    take: 10,
    select: { id: true, midias: true },
  });
  const origem = reels.find((r) => listaMidias(r.midias).length === 1);
  if (!origem) return NextResponse.json({ error: "Nenhum Reel com vídeo no calendário para usar no teste" }, { status: 409, headers: NO_STORE });

  const post: PostParaPublicar = { id: `teste-${origem.id}`, tipo: "REEL", midias: origem.midias, legenda: TEXTO_TESTE };
  const graph = rede === "facebook" ? await graphDoAmbiente() : null;
  const limpar = (t: string) => semChave(semToken(t, graph?.token ?? ""), composioConfig()?.apiKey ?? "");

  try {
    if (rede === "youtube") {
      const r = await publicarYoutube(
        post,
        { id: "teste", rede: "youtube", titulo: TITULO_TESTE, descricao: TEXTO_TESTE },
        // Privado sempre, qualquer que seja OPI_YOUTUBE_PRIVACIDADE.
        { fetch, env: { ...process.env, OPI_YOUTUBE_PRIVACIDADE: "private" } },
      );
      if (r.situacao !== "publicado") return NextResponse.json({ ok: false, rede, detalhe: r.motivo }, { headers: NO_STORE });
      return NextResponse.json(
        { ok: true, rede, id: r.externoId, link: `https://studio.youtube.com/video/${r.externoId}/edit`, detalhe: "Vídeo privado enviado ao canal." },
        { headers: NO_STORE },
      );
    }
    if (!graph) return NextResponse.json({ ok: false, rede, detalhe: "Configuração da Meta ausente" }, { headers: NO_STORE });
    const r = await publicarReelFacebook(post, graph, { estado: "DRAFT" });
    if (r.situacao !== "publicado") return NextResponse.json({ ok: false, rede, detalhe: r.motivo }, { headers: NO_STORE });
    return NextResponse.json({ ok: true, rede, id: r.externoId, link: null, detalhe: "Reel enviado como rascunho da Página." }, { headers: NO_STORE });
  } catch (e) {
    return NextResponse.json({ ok: false, rede, detalhe: limpar(e instanceof Error ? e.message : "Erro desconhecido") }, { headers: NO_STORE });
  }
}
