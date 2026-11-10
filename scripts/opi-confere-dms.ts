// OPI: lista os textos aprovados e as campanhas de DM em produção (SÓ LEITURA).
// Uso: npx tsx --env-file=C:/opi-work/openreply/.env scripts/opi-confere-dms.ts
import { prisma as db } from "../lib/db/client";
async function main() {
  const conta = await db.instagramAccount.findFirstOrThrow({ where: { username: "opcoesparainvestidores" } });
  const ws = conta.workspaceId;
  const textos = await db.textoAprovado.findMany({ where: { workspaceId: ws }, orderBy: { palavra: "asc" } });
  for (const t of textos) console.log(`\n[TEXTO ${t.palavra}] ativo=${t.ativo}\n${t.dmMessage}\n-> resposta: ${t.respostaPublica}`);
  const camps = await db.automation.findMany({ where: { workspaceId: ws }, orderBy: { name: "asc" } });
  for (const a of camps)
    console.log(`\n[CAMPANHA ${a.name}] ativa=${a.isActive} palavras=${a.keywords.join(",")} alvo=${a.postUrl} pendente=${a.pendingNextReel} igualAoTexto=${textos.some((t) => t.dmMessage === a.dmMessage)}`);
  const posts = await db.postAgendado.findMany({
    where: { workspaceId: ws, OR: [{ legenda: { contains: "Acertar a direção" } }, { legenda: { contains: "trava de alta e straddle" } }, { legenda: { contains: "venda coberta é um fluxo" } }] },
  });
  for (const p of posts) console.log(`\n[POST ${p.id}] ${p.status + " " + p.agendadoPara.toISOString()}\n${p.legenda.slice(0, 80)}...`);
}
main().finally(() => db.$disconnect());
