// Constantes do módulo Palavras-chave que também vão para o navegador (sem node:crypto).

/** Aviso obrigatório em todo texto da marca (AGENTS.md, regra 4). */
export const AVISO_OBRIGATORIO = "Conteúdo educativo. Não é recomendação individual de investimento.";

export const AVISO_COMPLIANCE =
  "Texto novo só entra depois de a Compliance aprovar. A DM precisa conter o aviso obrigatório: \"" +
  AVISO_OBRIGATORIO +
  "\". Sem recomendação individual, sem garantia de retorno e com exemplos hipotéticos.";

/** Igual a FRASE_RESPOSTA_PUBLICA em lib/opi/jev-gate.ts (com o portão ligado, só ela sai). */
export const RESPOSTA_PUBLICA_PADRAO = "Te mandei na DM! 📩";
