/**
 * Tipos comuns dos publicadores por rede (lib/opi/publicadores/*).
 * Cada publicador recebe o post e o destino e devolve um ResultadoDestino, ou lança PublicadorErro.
 */

export type PostParaPublicar = {
  id: string;
  tipo: "CARROSSEL" | "REEL" | "POST";
  midias: unknown;
  legenda: string;
};

export type DestinoParaPublicar = {
  id: string;
  rede: string;
  titulo?: string | null;
  descricao?: string | null;
  aprovadoEm?: Date | string | null;
};

export type ResultadoDestino =
  /** Saiu na rede. */
  | { situacao: "publicado"; externoId: string; permalink: string | null }
  /** A rede não recebe este tipo de post (ou não tem publicador). Não é falha, não alerta. */
  | { situacao: "pulado"; motivo: string }
  /** Falta configuração ou aprovação. O destino segue PENDENTE, sem contar tentativa e sem alerta. */
  | { situacao: "aguardando"; motivo: string };

export class PublicadorErro extends Error {
  /**
   * true só quando é certo que nada chegou a ser publicado (falha antes da chamada que publica).
   * O publicador tenta de novo na próxima rodada, até o limite de tentativas. Na dúvida fica false:
   * o destino vira ERRO e só volta com nova aprovação, para nunca publicar duas vezes.
   */
  readonly repetivel: boolean;
  constructor(message: string, opcoes: { repetivel?: boolean } = {}) {
    super(message);
    this.name = "PublicadorErro";
    this.repetivel = opcoes.repetivel === true;
  }
}

export const pulado = (motivo: string): ResultadoDestino => ({ situacao: "pulado", motivo });
export const aguardando = (motivo: string): ResultadoDestino => ({ situacao: "aguardando", motivo });

/** URLs https das mídias do post, na ordem. */
export function listaMidias(midias: unknown): string[] {
  if (!Array.isArray(midias)) return [];
  return midias.filter((m): m is string => typeof m === "string" && m.startsWith("https://"));
}

export const esperaPadrao = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
