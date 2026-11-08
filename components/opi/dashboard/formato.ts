// Formatação pt-BR do Dashboard (servidor e cliente).
const fmtNumero = new Intl.NumberFormat("pt-BR");
const fmtBRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const fmtPct = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export const numero = (n: number) => fmtNumero.format(n);
export const brl = (n: number) => fmtBRL.format(n);
export const pct = (n: number) => `${fmtPct.format(n)}%`;

export function valorFormatado(v: number, formato: "numero" | "brl" | "pct"): string {
  return formato === "brl" ? brl(v) : formato === "pct" ? pct(v) : numero(v);
}

/** "+3,2%" / "−1,5%"; em pontos percentuais com `pp`. */
export function deltaTexto(delta: number, pp = false): string {
  const sinal = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return `${sinal}${fmtPct.format(Math.abs(delta))}${pp ? " p.p." : "%"}`;
}
