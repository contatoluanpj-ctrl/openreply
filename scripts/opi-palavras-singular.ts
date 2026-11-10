// OPI: acrescenta o singular às campanhas (pedido do Luan, 10/11/2026): ESTRATEGIA e TERMO.
// O comparador já ignora maiúscula, acento e pontuação; o singular precisava ser palavra à parte.
// ERRO e JURO ficam de fora: são palavras comuns e disparariam DM sem pedido.
// Uso: npx tsx --env-file=C:/opi-work/openreply/.env scripts/opi-palavras-singular.ts
import { prisma as db } from "../lib/db/client";
const EXTRAS: Record<string, string> = { ESTRATEGIAS: "ESTRATEGIA", TERMOS: "TERMO" };
async function main() {
  const conta = await db.instagramAccount.findFirstOrThrow({ where: { username: "opcoesparainvestidores" } });
  for (const [plural, singular] of Object.entries(EXTRAS)) {
    const camps = await db.automation.findMany({ where: { workspaceId: conta.workspaceId, keywords: { has: plural } } });
    for (const a of camps) {
      const keywords = a.keywords.includes(singular) ? a.keywords : [...a.keywords, singular];
      await db.automation.update({ where: { id: a.id }, data: { keywords } });
      console.log(a.name, "->", keywords.join(", "));
    }
  }
}
main().finally(() => db.$disconnect());
