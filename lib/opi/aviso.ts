/** Aviso obrigatório de toda legenda da OPI (regra 4 do AGENTS.md da OPI). */
export const AVISO_OBRIGATORIO =
  "Conteúdo educativo. Não é recomendação individual de investimento.";

function normalizar(texto: string): string {
  return texto.normalize("NFC").replace(/\s+/g, " ").trim().toLocaleLowerCase("pt-BR");
}

/** true quando a legenda contém o aviso, ignorando espaços extras e maiúsculas. */
export function temAviso(legenda: string | null | undefined): boolean {
  if (!legenda) return false;
  return normalizar(legenda).includes(normalizar(AVISO_OBRIGATORIO));
}
