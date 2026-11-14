// Textos dos destinos de um post (uma rede cada) para as telas do Calendário. Só funções puras:
// rótulo do status, quando cabe "Aprovar" ou "Tentar de novo" e a mensagem de erro em linguagem legível.
import { REDES_APROVACAO_PROPRIA, type DestinoStatusOpi, type DestinoView } from "@/lib/opi/destinos";

export const DESTINO_ROTULO: Record<DestinoStatusOpi, string> = {
  PENDENTE: "Pendente",
  PUBLICANDO: "Publicando",
  PUBLICADO: "Publicado",
  ERRO: "Erro",
  PULADO: "Pulado",
};

type DestinoBase = Pick<DestinoView, "rede" | "status" | "aprovadoEm">;

/**
 * LinkedIn e X só saem com aprovação própria do destino. Só cabe aprovar o que ainda pode sair:
 * pendente ou com erro. Publicado ou em publicação não muda mais, e pulado não vai ser publicado.
 */
export function precisaAprovar(d: DestinoBase): boolean {
  if (!(REDES_APROVACAO_PROPRIA as readonly string[]).includes(d.rede)) return false;
  if (d.status !== "PENDENTE" && d.status !== "ERRO") return false;
  return !d.aprovadoEm;
}

export function podeTentarDeNovo(d: Pick<DestinoView, "status">): boolean {
  return d.status === "ERRO";
}

/** Texto do selo: o status, ou "Aguardando aprovação" quando o destino pendente ainda não foi aprovado. */
export function rotuloDestino(d: DestinoBase): string {
  if (d.status === "PENDENTE" && precisaAprovar(d)) return "Aguardando aprovação";
  return DESTINO_ROTULO[d.status] ?? d.status;
}

/** "Instagram: Publicado; Facebook: Erro" — para title e leitor de tela. */
export function descreverDestinos(destinos: Array<DestinoBase & Pick<DestinoView, "nome">>): string {
  return destinos.map((d) => `${d.nome}: ${rotuloDestino(d)}`).join("; ");
}

/** "2/3" publicados, ou null quando o post ainda não tem destino. */
export function contagemPublicados(destinos: Array<Pick<DestinoView, "status">>): string | null {
  if (destinos.length === 0) return null;
  return `${destinos.filter((d) => d.status === "PUBLICADO").length}/${destinos.length}`;
}

const ERRO_MAX = 220;

function mensagemDoJson(valor: unknown): string | null {
  if (typeof valor === "string") return valor;
  if (!valor || typeof valor !== "object") return null;
  const o = valor as Record<string, unknown>;
  for (const chave of ["error_user_msg", "message", "error_description", "error", "detail", "erro"]) {
    const m = mensagemDoJson(o[chave]);
    if (m) return m;
  }
  return null;
}

/**
 * Deixa o erro gravado pelo publicador legível: tira o JSON bruto da API (fica só a mensagem),
 * junta espaços e quebras de linha e corta textos longos. Sem erro gravado, diz isso com clareza.
 */
export function erroLegivel(erro: string | null | undefined): string {
  let texto = (erro ?? "").trim();
  if (!texto) return "A rede não informou o motivo da falha.";
  const inicio = texto.indexOf("{");
  if (inicio !== -1) {
    try {
      const mensagem = mensagemDoJson(JSON.parse(texto.slice(inicio)));
      if (mensagem) texto = `${texto.slice(0, inicio)}${mensagem}`;
    } catch {
      // Não era JSON: segue o texto como veio.
    }
  }
  texto = texto.replace(/\s+/g, " ").trim();
  return texto.length > ERRO_MAX ? `${texto.slice(0, ERRO_MAX - 1).trimEnd()}…` : texto;
}
