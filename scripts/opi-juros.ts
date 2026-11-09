// OPI: palavra JUROS (vídeo 07 JUROS, Reel de 12/11 18h, PostAgendado cmw8amcnn0000ykhn1bfipymp).
// Pedido do Luan (08/11): "Preciso das respostas dos comentários prontas". Mesmo molde curto da TERMOS
// (3 linhas, 1 emoji por linha) e a mesma resposta pública aprovada por ele.
// A campanha nasce PRESA AO POST AGENDADO (postUrl "agendado:<id>"), não ao "próximo Reel":
//   --inerte  -> pendingNextReel false (seguro com o worker antigo, que prenderia ao 09/11 PUT)
//   (padrão)  -> pendingNextReel true (só depois do worker com o commit do alvo no ar)
// Uso: npx tsx --env-file=C:/opi-work/openreply/.env scripts/opi-juros.ts [--inerte]
import { prisma as db } from "../lib/db/client";
const POST_AGENDADO = "cmw8amcnn0000ykhn1bfipymp";
const DM = [
  "👋 Oi! Que bom ter você por aqui.",
  "📄 Seu mapa da Selic ao seu bolso: https://opi-opcoes-para-investidores.vercel.app/materiais/juros.pdf?utm_source=instagram&utm_medium=dm&utm_campaign=OPI-REEL-017",
  "📚 Conteúdo educativo. Não é recomendação individual de investimento.",
].join("\n");
async function main() {
  const inerte = process.argv.includes("--inerte");
  const conta = await db.instagramAccount.findFirstOrThrow({ where: { username: "opcoesparainvestidores" } });
  const termos = await db.textoAprovado.findUniqueOrThrow({
    where: { workspaceId_palavra: { workspaceId: conta.workspaceId, palavra: "TERMOS" } },
  });
  const RESPOSTA = termos.respostaPublica; // a frase do Luan, igual à da TERMOS
  const post = await db.postAgendado.findUniqueOrThrow({ where: { id: POST_AGENDADO } });
  if (!post.legenda.includes("Juros")) throw new Error("o post agendado não é o 07 JUROS");
  const t = await db.textoAprovado.upsert({
    where: { workspaceId_palavra: { workspaceId: conta.workspaceId, palavra: "JUROS" } },
    create: { workspaceId: conta.workspaceId, palavra: "JUROS", dmMessage: DM, respostaPublica: RESPOSTA, aprovadoPor: 'Luan ("Preciso das respostas dos comentários prontas", 08/11/2026); 1ª DM pausa para a Compliance' },
    update: { dmMessage: DM, respostaPublica: RESPOSTA, ativo: true },
  });
  const dados = {
    name: "JUROS (Reel 07 · 12/11 · mapa da Selic)", goal: "Entregar o PDF do mapa da Selic a quem comentar JUROS",
    postId: null, postUrl: "agendado:" + POST_AGENDADO, pendingNextReel: !inerte, matchAnyPost: false,
    keywords: ["JUROS"], matchAnyWord: false, wholeWordMatch: true, dmMessage: DM,
    publicReplyEnabled: true, publicReplyMessage: RESPOSTA, publicReplyMessages: [RESPOSTA],
    openingDmEnabled: false, requireFollow: false, followUpEnabled: false, dmTriggerEnabled: false, isActive: true,
  };
  const existente = await db.automation.findFirst({ where: { workspaceId: conta.workspaceId, keywords: { has: "JUROS" } } });
  const a = existente
    ? await db.automation.update({ where: { id: existente.id }, data: dados })
    : await db.automation.create({ data: { ...dados, workspaceId: conta.workspaceId, instagramAccountId: conta.id } });
  console.log("texto", t.palavra, "ativo", t.ativo, "| campanha", a.id, "ativa", a.isActive, "pendente", a.pendingNextReel, "alvo", a.postUrl);
}
main().finally(() => db.$disconnect());
