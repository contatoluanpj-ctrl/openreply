/**
 * Cores dos gráficos do OPI Central. Só variáveis do tema (app/globals.css, bloco .opi-central):
 * nenhuma cor fixa aqui, para o gráfico acompanhar as variantes A e B.
 * O recharts repassa o valor para o SVG, e o navegador resolve o var() dentro do contêiner.
 */
export const COR_GRAFICO = {
  /** Série em destaque (laranja). */
  principal: "var(--opi-chart-1)",
  /** Segunda série (cinza claro). */
  secundaria: "var(--opi-chart-2)",
  /** Série de apoio (cinza médio). */
  terciaria: "var(--opi-chart-3)",
  /** Fatia "nenhuma"/resto. */
  quaternaria: "var(--opi-chart-5)",
  grade: "var(--opi-chart-grid)",
  eixo: "var(--opi-chart-axis)",
  /** Faixa/linha que acompanha o mouse. */
  cursor: "var(--opi-chart-cursor)",
  /** Contorno do ponto ativo: a cor do fundo, para o ponto "furar" a linha. */
  contorno: "var(--color-background)",
  texto: "var(--color-foreground)",
} as const;

/** Rampa para pizza/rosca, do destaque ao mais apagado. */
export const RAMPA_GRAFICO: readonly string[] = [
  "var(--opi-chart-1)",
  "var(--opi-chart-2)",
  "var(--opi-chart-3)",
  "var(--opi-chart-4)",
  "var(--opi-chart-5)",
  "var(--opi-chart-6)",
  "var(--opi-chart-7)",
];

export const EIXO_GRAFICO = { fontSize: 11, fill: COR_GRAFICO.eixo } as const;
