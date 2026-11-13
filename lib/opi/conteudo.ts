// Desempenho por Reel (/dashboard/conteudo). Funções puras sobre os posts que /api/instagram/overview devolve.
// Indicador principal da OPI: (salvamentos + compartilhamentos) por 1.000 visualizações. Mede se o conteúdo
// foi útil o bastante para guardar ou mandar para alguém, sem depender do tamanho do alcance.

export type PostBruto = {
  id: string;
  caption: string | null;
  permalink: string | null;
  mediaType: string;
  timestamp: string;
  views: number | null;
  reach: number | null;
  likes: number;
  comments: number;
  saved: number | null;
  shares: number | null;
};

export type LinhaConteudo = PostBruto & {
  /** (salvamentos + compartilhamentos) ÷ visualizações × 1.000, 1 casa. Null sem visualizações ou sem os dois números. */
  indice: number | null;
  /** Entra no destaque de melhor/pior (tem visualizações suficientes para o índice não ser ruído). */
  comparavel: boolean;
};

/** Abaixo disso o índice oscila demais (1 salvamento em 20 views daria 50 por mil). */
export const MIN_VIEWS_DESTAQUE = 100;

export function indicePorMil(saved: number | null, shares: number | null, views: number | null): number | null {
  if (views === null || !Number.isFinite(views) || views <= 0) return null;
  if (saved === null && shares === null) return null;
  return Math.round((((saved ?? 0) + (shares ?? 0)) / views) * 10000) / 10;
}

export function linhasConteudo(posts: PostBruto[]): LinhaConteudo[] {
  return posts.map((p) => {
    const indice = indicePorMil(p.saved, p.shares, p.views);
    return { ...p, indice, comparavel: indice !== null && (p.views ?? 0) >= MIN_VIEWS_DESTAQUE };
  });
}

/** Melhor e pior pelo índice, só entre os comparáveis. Com menos de 2, não há pior; empate fica com o mais recente. */
export function melhorEPior(linhas: LinhaConteudo[]): { melhorId: string | null; piorId: string | null } {
  const c = linhas
    .filter((l) => l.comparavel)
    .sort((a, b) => (b.indice ?? 0) - (a.indice ?? 0) || b.timestamp.localeCompare(a.timestamp));
  if (c.length === 0) return { melhorId: null, piorId: null };
  if (c.length === 1) return { melhorId: c[0].id, piorId: null };
  return { melhorId: c[0].id, piorId: c[c.length - 1].id };
}

export type ColunaConteudo = "timestamp" | "views" | "reach" | "saved" | "shares" | "comments" | "indice";
export type Direcao = "asc" | "desc";

/** Ordena sem mexer na lista original. Sem número (null) vai sempre para o fim, nas duas direções. */
export function ordenarConteudo(linhas: LinhaConteudo[], coluna: ColunaConteudo, direcao: Direcao): LinhaConteudo[] {
  const sinal = direcao === "asc" ? 1 : -1;
  return [...linhas].sort((a, b) => {
    if (coluna === "timestamp") return sinal * a.timestamp.localeCompare(b.timestamp);
    const va = a[coluna];
    const vb = b[coluna];
    if (va === null && vb === null) return b.timestamp.localeCompare(a.timestamp);
    if (va === null) return 1;
    if (vb === null) return -1;
    return sinal * (va - vb) || b.timestamp.localeCompare(a.timestamp);
  });
}

/** Começo da legenda em uma linha. */
export function inicioLegenda(caption: string | null, max = 70): string {
  const t = (caption ?? "").replace(/\s+/g, " ").trim();
  if (!t) return "Sem legenda";
  return t.length > max ? t.slice(0, max - 1).trimEnd() + "…" : t;
}

/** Índice da conta no período: soma dos salvamentos e compartilhamentos ÷ soma das visualizações × 1.000. */
export function indiceGeral(linhas: LinhaConteudo[]): number | null {
  const com = linhas.filter((l) => l.indice !== null);
  const views = com.reduce((t, l) => t + (l.views ?? 0), 0);
  if (views <= 0) return null;
  const guardou = com.reduce((t, l) => t + (l.saved ?? 0) + (l.shares ?? 0), 0);
  return Math.round((guardou / views) * 10000) / 10;
}
