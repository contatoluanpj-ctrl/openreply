/**
 * Variante do tema escuro do OPI Central, escolhida pelo atributo data-tema no contêiner .opi-central.
 * "a" = preto neutro com vidro (padrão); "b" = grafite azulado. A escolha fica num cookie para o servidor
 * já entregar a página na variante certa (sem piscar).
 */
export type TemaOpi = "a" | "b";

export const TEMA_PADRAO: TemaOpi = "a";
export const COOKIE_TEMA = "opi_tema";

export function lerTema(valor: string | null | undefined): TemaOpi {
  return valor === "b" ? "b" : TEMA_PADRAO;
}

/** Texto do cookie (1 ano, só leitura de layout: não é dado sensível). */
export function cookieDoTema(tema: TemaOpi): string {
  return `${COOKIE_TEMA}=${tema}; path=/; max-age=31536000; samesite=lax`;
}
