/**
 * Agregações puras da página Equipe (organograma + painel do agente). Sem banco: usável no cliente.
 */
import { estaAtivo, type MembroEquipe, type PedidoResumo } from "./agentes";

export type EstadoNo = "ativo" | "sob-demanda" | "futuro";

/** ACTIVE = laranja pulsando; ON-DEMAND = cinza; FUTURE e "ainda não justificado" = apagado. */
export function estadoDoMembro(membro: MembroEquipe): EstadoNo {
  if (!membro.status || membro.status === "ACTIVE") return "ativo";
  if (membro.status === "ON-DEMAND") return "sob-demanda";
  return "futuro";
}

const LIGACOES = new Set(["de", "da", "do", "das", "dos", "e"]);

/** "Editor de vídeos" → "EV"; "CEO" → "CEO"; "Data & Scorecard Analyst" → "DS". */
export function iniciais(nome: string): string {
  const palavras = nome
    .split(/[\s/&()-]+/)
    .map((p) => p.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter((p) => p && !LIGACOES.has(p.toLowerCase()));
  if (palavras.length === 0) return "?";
  if (palavras.length === 1) {
    const [p] = palavras;
    return p.length <= 3 && p === p.toUpperCase() ? p : p.slice(0, 2).toUpperCase();
  }
  return (palavras[0][0] + palavras[1][0]).toUpperCase();
}

export interface ColunaOrganograma {
  chefe: MembroEquipe;
  equipe: MembroEquipe[];
}

export interface Organograma {
  colunas: ColunaOrganograma[];
  /** Operacionais cujo reportaA não bate com nenhum C-level (não deveria acontecer). */
  semChefe: MembroEquipe[];
}

/**
 * Todos os C-levels no mesmo nível. Os que têm equipe ficam no meio (logo abaixo do fundador),
 * os demais se dividem à esquerda e à direita, mantendo a ordem do registro (os futuros caem à direita).
 */
export function montarOrganograma(
  cLevels: readonly MembroEquipe[],
  operacionais: readonly MembroEquipe[],
): Organograma {
  const ids = new Set(cLevels.map((c) => c.id));
  const coluna = (chefe: MembroEquipe): ColunaOrganograma => ({
    chefe,
    equipe: operacionais.filter((o) => o.reportaA === chefe.id),
  });
  const comEquipe = cLevels.map(coluna).filter((c) => c.equipe.length > 0);
  const semEquipe = cLevels.map(coluna).filter((c) => c.equipe.length === 0);
  const metade = Math.floor(semEquipe.length / 2);
  return {
    colunas: [...semEquipe.slice(0, metade), ...comEquipe, ...semEquipe.slice(metade)],
    semChefe: operacionais.filter((o) => !o.reportaA || !ids.has(o.reportaA)),
  };
}

export interface ResumoAgente {
  agente: string;
  /** Trabalhando agora: pedido em andamento ou atividade nos últimos 15 minutos. */
  ativo: boolean;
  ultimo: string | null;
  /** Pedidos ainda na fila (NOVO) ou em andamento. */
  abertos: number;
}

export interface PedidoParaResumo extends PedidoResumo {
  agente: string;
}

/** Um resumo por id, na ordem dos ids; pedidos de ids fora da lista são ignorados. */
export function resumirPedidos(
  ids: readonly string[],
  pedidos: readonly PedidoParaResumo[],
  agora: Date = new Date(),
): ResumoAgente[] {
  return ids.map((id) => {
    const doAgente = pedidos
      .filter((p) => p.agente === id)
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    const ultimo = doAgente[0]?.updatedAt;
    return {
      agente: id,
      ativo: estaAtivo(doAgente, agora),
      ultimo: ultimo ? new Date(ultimo).toISOString() : null,
      abertos: doAgente.filter((p) => p.status === "NOVO" || p.status === "EM_ANDAMENTO").length,
    };
  });
}

export interface PedidoHistorico {
  id: string;
  createdAt: string;
}

/** Mais recente primeiro, no máximo `limite` itens (o GET devolve em ordem cronológica). */
export function historicoRecente<T extends PedidoHistorico>(pedidos: readonly T[], limite = 8): T[] {
  return [...pedidos]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limite);
}
