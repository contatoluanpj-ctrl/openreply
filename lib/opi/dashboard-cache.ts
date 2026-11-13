import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/client";
import { carregarDashboard, type Dashboard } from "@/lib/opi/dashboard-dados";
import { carregarHoje, type Hoje } from "@/lib/opi/hoje";
import { carregarVisaoGeral, type VisaoGeral } from "@/lib/opi/visao-geral";

/**
 * Cache curto do Dashboard (agregados pesados: até 90 dias de DMs, seguidores, redes, posts, gasto).
 * Voltar ao Dashboard dentro de 30 s não refaz as ~20 consultas; depois disso a próxima visita
 * recalcula. Separado por workspace. As datas atravessam o cache como {"$d": iso} e voltam a ser Date.
 */
export const DASHBOARD_CACHE_SEGUNDOS = 30;

type Painel = { d: Dashboard; v: VisaoGeral; h: Hoje; agora: Date };

export function serializarComDatas(valor: unknown): string {
  return JSON.stringify(valor, function (this: Record<string, unknown>, chave, v) {
    const original = this[chave];
    return original instanceof Date ? { $d: original.toISOString() } : v;
  });
}

export function desserializarComDatas<T>(texto: string): T {
  return JSON.parse(texto, (_chave, v) =>
    v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).length === 1 && typeof v.$d === "string"
      ? new Date(v.$d)
      : v,
  ) as T;
}

export async function carregarPainelDashboard(workspaceId: string): Promise<Painel> {
  const calcular = unstable_cache(
    async () => {
      const agora = new Date();
      const [d, v, h] = await Promise.all([
        carregarDashboard(prisma, workspaceId, agora),
        carregarVisaoGeral(prisma, workspaceId, agora),
        carregarHoje(prisma, workspaceId, agora),
      ]);
      return serializarComDatas({ d, v, h, agora });
    },
    ["opi-dashboard-v2", workspaceId],
    { revalidate: DASHBOARD_CACHE_SEGUNDOS, tags: [`opi-dashboard:${workspaceId}`] },
  );
  return desserializarComDatas<Painel>(await calcular());
}
