// OPI: campanha "próximo Reel" presa a um post agendado específico.
// Sem mudar o schema: enquanto a campanha espera (pendingNextReel = true), o postUrl guarda
// "agendado:<id do PostAgendado>". Ela só é presa quando ESSE post sair; as campanhas sem alvo
// continuam pegando o próximo Reel, como antes.
export const PREFIXO_ALVO = "agendado:";

export function alvoAgendado(postUrl: string | null | undefined): string | null {
  if (!postUrl || !postUrl.startsWith(PREFIXO_ALVO)) return null;
  const id = postUrl.slice(PREFIXO_ALVO.length).trim();
  return id || null;
}

/** Filtro Prisma: campanhas pendentes SEM alvo (postUrl nulo ou que não começa com "agendado:"). */
export const filtroSemAlvo = {
  OR: [{ postUrl: null }, { NOT: { postUrl: { startsWith: PREFIXO_ALVO } } }],
};
