// OPI: agenda o Reel 01 TERMOS (cenas) para 09/11/2026 12h (São Paulo), com o "sim" do Luan (08/11 ~02h45)
// e a legenda aprovada pela Compliance (PARECER-NOV-2026 §22-A). Liga a chave da publicação automática do workspace.
// Uso: npx tsx --env-file=C:/opi-work/openreply/.env scripts/opi-agenda-01.ts
import { prisma } from "../lib/db/client";
const LEGENDA = [
  "Call, put, strike, prêmio e vencimento são campos diferentes. O prêmio é o preço do direito; o strike é o preço de exercício do ativo. Quem compra a opção tem um direito, e quem vende assume uma obrigação caso haja exercício.",
  "",
  "Quer os 15 termos de opções (+5 de bônus) num PDF gratuito? Comente TERMOS aqui que eu te mando na DM. O material também fica no site da OPI, no link da bio.",
  "",
  "Conteúdo educativo. Não é recomendação individual de investimento.",
  "",
  "#Opções #MercadoFinanceiro #EducaçãoFinanceira #Derivativos",
].join("\n");
const VIDEO = "https://opi-openreply.vercel.app/m/4050dbb0947c43e8acbdaea4.mp4";
async function main() {
  const conta = await prisma.instagramAccount.findFirstOrThrow({ where: { username: "opcoesparainvestidores" } });
  const ws = conta.workspaceId;
  const outros = await prisma.postAgendado.findMany({ where: { workspaceId: ws, status: { in: ["APROVADO", "PUBLICANDO"] } }, select: { id: true, legenda: true, agendadoPara: true } });
  console.log("outros aprovados antes:", outros.length, outros.map((o) => o.agendadoPara.toISOString()));
  const dados = {
    workspaceId: ws, tipo: "REEL" as const, midias: [VIDEO], legenda: LEGENDA,
    agendadoPara: new Date("2026-11-09T15:00:00.000Z"), status: "APROVADO" as const,
    aprovadoEm: new Date(), aprovadoPor: "Luan (\"Sim, agenda\", 08/11/2026 ~02h45)",
  };
  const existente = await prisma.postAgendado.findFirst({ where: { workspaceId: ws, legenda: LEGENDA } });
  const p = existente ? await prisma.postAgendado.update({ where: { id: existente.id }, data: dados }) : await prisma.postAgendado.create({ data: dados });
  await prisma.workspace.update({ where: { id: ws }, data: { opiPublicadorLigado: true, opiPublicadorAlteradoEm: new Date(), opiPublicadorAlteradoPor: "Luan (sim ao agendamento do 01 TERMOS)" } });
  console.log("post", p.id, p.status, p.agendadoPara.toISOString(), "| chave ligada");
}
main().finally(() => prisma.$disconnect());
