import { prisma } from "@/lib/db/client";
import { getMetaGraphApiVersion } from "@/lib/env";
import { resolvePageAccessToken } from "@/lib/meta/facebook-login";
import { facebookInstagramUserId, facebookPageAccessToken, facebookPageId } from "@/lib/meta/login-mode";
import type { PublicarDeps } from "@/lib/opi/publicadores/graph";
import { REDES_TESTAVEIS, snapshotDoTeste, testarRedes, type RedeTestavel, type ResultadoTeste } from "@/lib/opi/redes-teste";

/** Dependências da Graph com o token da Página, ou null quando a configuração da Meta está ausente. */
export async function graphDoAmbiente(f: typeof fetch = fetch): Promise<PublicarDeps | null> {
  try {
    let pageId: string | undefined;
    try {
      pageId = facebookPageId();
    } catch {
      pageId = undefined;
    }
    return {
      fetch: f,
      token: await resolvePageAccessToken(facebookPageAccessToken()),
      igUserId: facebookInstagramUserId(),
      versao: getMetaGraphApiVersion(),
      pageId,
    };
  } catch {
    return null;
  }
}

/**
 * Testa as redes agora e grava um RedeSnapshot por rede no workspace.
 * É o mesmo código para o botão "Testar conexões" (painel) e para a coleta periódica (worker).
 */
export async function coletarRedes(
  workspaceId: string,
  opcoes: { redes?: readonly RedeTestavel[]; fetch?: typeof fetch; env?: Record<string, string | undefined> } = {},
): Promise<ResultadoTeste[]> {
  const f = opcoes.fetch ?? fetch;
  const graph = await graphDoAmbiente(f);
  const resultados = await testarRedes({ fetch: f, graph, env: opcoes.env }, opcoes.redes ?? REDES_TESTAVEIS);
  const agora = new Date();
  await prisma.redeSnapshot.createMany({
    data: resultados.map((r) => ({ workspaceId, coletadoEm: agora, ...snapshotDoTeste(r) })),
  });
  return resultados;
}

/** Workspaces que publicam pelo painel: são os que têm rede para coletar. */
export async function coletarRedesDeTodos(): Promise<number> {
  const donos = await prisma.workspace.findMany({ where: { opiPublicadorLigado: true }, select: { id: true } });
  for (const w of donos) await coletarRedes(w.id);
  return donos.length;
}
