import type { PrismaClient } from "@/app/generated/prisma/client";

/**
 * Destinos de publicação de um PostAgendado (modelo PostDestino): um por rede.
 * Aqui ficam as regras puras (quais redes, quem está pronto para sair, resumo do post) e os
 * utilitários de banco que as rotas, o publicador e os scripts compartilham.
 */

/** Redes que podem ser destino, na ordem em que o publicador tenta e a tela mostra. */
export const REDES_DESTINO = ["instagram", "facebook", "youtube", "linkedin", "x", "tiktok"] as const;
export type RedeDestino = (typeof REDES_DESTINO)[number];

/** Redes que podem ser criadas sozinhas na aprovação do calendário (OPI_DESTINOS_PADRAO). */
export const REDES_AUTOMATICAS: readonly RedeDestino[] = ["instagram", "facebook", "youtube"];
/** Redes que só saem com aprovação própria do destino (PostDestino.aprovadoEm). */
export const REDES_APROVACAO_PROPRIA: readonly RedeDestino[] = ["linkedin", "x"];
/** Redes publicadas pelo Composio. Sem COMPOSIO_API_KEY ficam PENDENTE. */
export const REDES_COMPOSIO: readonly RedeDestino[] = ["youtube", "linkedin", "x"];
/** Redes publicadas pela Graph da Meta. */
export const REDES_META: readonly RedeDestino[] = ["instagram", "facebook"];

export const DESTINO_STATUS = ["PENDENTE", "PUBLICANDO", "PUBLICADO", "ERRO", "PULADO"] as const;
export type DestinoStatusOpi = (typeof DESTINO_STATUS)[number];

/** Quantas vezes o publicador pega o mesmo destino dentro de uma aprovação. */
export const MAX_TENTATIVAS = 3;

export const NOME_REDE: Record<RedeDestino, string> = {
  instagram: "Instagram",
  facebook: "Facebook",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
  tiktok: "TikTok",
};

export function isRedeDestino(valor: unknown): valor is RedeDestino {
  return typeof valor === "string" && (REDES_DESTINO as readonly string[]).includes(valor);
}

export function nomeRede(rede: string): string {
  return isRedeDestino(rede) ? NOME_REDE[rede] : rede;
}

function ordemRede(rede: string): number {
  const i = (REDES_DESTINO as readonly string[]).indexOf(rede);
  return i === -1 ? REDES_DESTINO.length : i;
}

/** Ordena pela ordem fixa das redes (instagram primeiro). */
export function ordenarDestinos<T extends { rede: string }>(destinos: T[]): T[] {
  return [...destinos].sort((a, b) => ordemRede(a.rede) - ordemRede(b.rede) || a.rede.localeCompare(b.rede));
}

type Env = Record<string, string | undefined>;

/**
 * Destinos criados quando o post é aprovado no calendário.
 * - Reel: o que estiver em OPI_DESTINOS_PADRAO (padrão "instagram"), só entre instagram, facebook e youtube.
 *   linkedin e x nunca entram aqui, mesmo se escritos na variável.
 * - Carrossel e imagem: só instagram (as outras redes só recebem Reel).
 */
export function destinosPadrao(tipo: string, env: Env = process.env): RedeDestino[] {
  if (tipo !== "REEL") return ["instagram"];
  const pedidos = (env.OPI_DESTINOS_PADRAO ?? "")
    .split(",")
    .map((r) => r.trim().toLowerCase())
    .filter((r): r is RedeDestino => (REDES_AUTOMATICAS as readonly string[]).includes(r));
  const unicos = REDES_AUTOMATICAS.filter((r) => pedidos.includes(r));
  return unicos.length > 0 ? unicos : ["instagram"];
}

export type DestinoLinha = {
  id: string;
  rede: string;
  status: string;
  tentativas?: number | null;
  aprovadoEm?: Date | string | null;
  externoId?: string | null;
  permalink?: string | null;
  erro?: string | null;
};

/**
 * O destino está pronto para o publicador pegar nesta rodada?
 * A mesma regra vira filtro do banco em filtroDestinoElegivel: mude as duas juntas.
 */
export function destinoElegivel(d: DestinoLinha, composioConfigurado: boolean): boolean {
  if (d.status !== "PENDENTE") return false;
  if ((d.tentativas ?? 0) >= MAX_TENTATIVAS) return false;
  if (!composioConfigurado && (REDES_COMPOSIO as readonly string[]).includes(d.rede)) return false;
  if ((REDES_APROVACAO_PROPRIA as readonly string[]).includes(d.rede) && !d.aprovadoEm) return false;
  return true;
}

/** Filtro Prisma equivalente a destinoElegivel. */
export function filtroDestinoElegivel(composioConfigurado: boolean) {
  return {
    status: "PENDENTE" as const,
    tentativas: { lt: MAX_TENTATIVAS },
    ...(composioConfigurado ? {} : { rede: { notIn: [...REDES_COMPOSIO] } }),
    OR: [{ rede: { notIn: [...REDES_APROVACAO_PROPRIA] } }, { aprovadoEm: { not: null } }],
  };
}

export type ResumoPost =
  | { status: "PUBLICADO"; mediaId: string | null; permalink: string | null; erro: null }
  | { status: "ERRO"; erro: string }
  | { status: "APROVADO" };

/**
 * PostAgendado.status como resumo dos destinos (compatível com as telas atuais):
 * - com destino instagram, vale o dele: PUBLICADO quando o Instagram publicou, ERRO quando falhou;
 * - sem instagram (ou instagram PULADO): PUBLICADO quando algum destino saiu e nenhum está pendente,
 *   ERRO quando sobrou só falha, APROVADO enquanto houver destino por sair.
 * mediaId e permalink do post espelham o Instagram (as campanhas de DM usam esses campos).
 */
export function resumoDoPost(destinos: DestinoLinha[]): ResumoPost {
  const ig = destinos.find((d) => d.rede === "instagram");
  if (ig && ig.status === "PUBLICADO") {
    return { status: "PUBLICADO", mediaId: ig.externoId ?? null, permalink: ig.permalink ?? null, erro: null };
  }
  if (ig && ig.status === "ERRO") return { status: "ERRO", erro: ig.erro ?? "Falha ao publicar no Instagram" };
  if (ig && (ig.status === "PENDENTE" || ig.status === "PUBLICANDO")) return { status: "APROVADO" };

  if (destinos.some((d) => d.status === "PENDENTE" || d.status === "PUBLICANDO")) return { status: "APROVADO" };
  const publicado = ordenarDestinos(destinos).find((d) => d.status === "PUBLICADO");
  if (publicado) return { status: "PUBLICADO", mediaId: null, permalink: publicado.permalink ?? null, erro: null };
  const falha = ordenarDestinos(destinos).find((d) => d.status === "ERRO");
  if (falha) return { status: "ERRO", erro: `${nomeRede(falha.rede)}: ${falha.erro ?? "falha ao publicar"}` };
  return { status: "ERRO", erro: "Nenhuma rede aceita este tipo de post. Nada foi publicado." };
}

/** Forma do destino nas respostas da API (datas em ISO). */
export type DestinoView = {
  id: string;
  rede: string;
  nome: string;
  status: DestinoStatusOpi;
  externoId: string | null;
  permalink: string | null;
  erro: string | null;
  tentativas: number;
  publicadoEm: string | null;
  titulo: string | null;
  descricao: string | null;
  aprovadoEm: string | null;
};

/** Campos do PostDestino que a API devolve. */
export const SELECT_DESTINO = {
  id: true,
  rede: true,
  status: true,
  externoId: true,
  permalink: true,
  erro: true,
  tentativas: true,
  publicadoEm: true,
  titulo: true,
  descricao: true,
  aprovadoEm: true,
} as const;

type DestinoBanco = {
  id: string;
  rede: string;
  status: string;
  externoId: string | null;
  permalink: string | null;
  erro: string | null;
  tentativas: number;
  publicadoEm: Date | string | null;
  titulo: string | null;
  descricao: string | null;
  aprovadoEm: Date | string | null;
};

const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

export function paraDestinosView(destinos: DestinoBanco[] | null | undefined): DestinoView[] {
  return ordenarDestinos(destinos ?? []).map((d) => ({
    id: d.id,
    rede: d.rede,
    nome: nomeRede(d.rede),
    status: d.status as DestinoStatusOpi,
    externoId: d.externoId,
    permalink: d.permalink,
    erro: d.erro,
    tentativas: d.tentativas,
    publicadoEm: iso(d.publicadoEm),
    titulo: d.titulo,
    descricao: d.descricao,
    aprovadoEm: iso(d.aprovadoEm),
  }));
}

export type DbDestinos = Pick<PrismaClient, "postDestino">;

/**
 * Prepara os destinos dos posts que estão sendo aprovados:
 * cria os destinos padrão que faltam e devolve para PENDENTE os que ficaram em ERRO ou PULADO
 * (nova aprovação = nova tentativa). Destino PUBLICADO nunca é tocado: não se publica duas vezes.
 */
export async function prepararDestinosNaAprovacao(
  db: DbDestinos,
  posts: Array<{ id: string; tipo: string }>,
  env: Env = process.env,
): Promise<void> {
  if (posts.length === 0) return;
  const novos = posts.flatMap((p) => destinosPadrao(p.tipo, env).map((rede) => ({ postId: p.id, rede })));
  await db.postDestino.createMany({ data: novos, skipDuplicates: true });
  await db.postDestino.updateMany({
    where: { postId: { in: posts.map((p) => p.id) }, status: { in: ["ERRO", "PULADO"] } },
    data: { status: "PENDENTE", erro: null, tentativas: 0 },
  });
}

/** Data do último post publicado em cada rede do workspace (para a tela Redes). */
export async function ultimoPublicadoPorRede(db: DbDestinos, workspaceId: string): Promise<Record<string, string>> {
  const grupos = await db.postDestino.groupBy({
    by: ["rede"],
    where: { status: "PUBLICADO", publicadoEm: { not: null }, post: { workspaceId } },
    _max: { publicadoEm: true },
  });
  const saida: Record<string, string> = {};
  for (const g of grupos) {
    const d = g._max.publicadoEm;
    if (d) saida[g.rede] = new Date(d).toISOString();
  }
  return saida;
}
