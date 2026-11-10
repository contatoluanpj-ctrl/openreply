// OPI: troca a legenda do 03 ERROS (18/11) NO MESMO PostAgendado (a campanha ERROS aponta para o id dele).
// Legenda nova aprovada pelo Luan ("Sim", 09/11/2026) e pela Compliance (PARECER-NOV-2026 §25).
// Só troca se a legenda atual for exatamente a antiga e o post ainda estiver APROVADO (não publicado).
// Uso: npx tsx --env-file=C:/opi-work/openreply/.env scripts/opi-legenda-erros.ts
import { prisma as db } from "../lib/db/client";
const ID = "cmw8lb65i000008hnb2dogl67";
const P1 = "Acertar a direção não assegura resultado positivo em uma opção. A magnitude e o prazo do movimento, o prêmio pago e a volatilidade importam. Preço antes do vencimento e payoff no vencimento são análises diferentes.";
const AVISO = "Conteúdo educativo. Não é recomendação individual de investimento.";
const TAGS = "#Opções #Call #Derivativos #EducaçãoFinanceira";
const ANTIGA = [P1, "O material gratuito está no site da OPI, no link da bio.", AVISO, TAGS].join("\n\n");
const NOVA = [P1, "Comente ERROS que a OPI te manda o link do material gratuito na DM. Ele também está no site, no link da bio.", AVISO, TAGS].join("\n\n");
async function main() {
  const p = await db.postAgendado.findUniqueOrThrow({ where: { id: ID } });
  if (p.legenda === NOVA) return console.log("já está com a legenda nova");
  if (p.status !== "APROVADO") throw new Error("status inesperado: " + p.status);
  if (p.legenda.trim() !== ANTIGA) throw new Error("a legenda atual não é a antiga esperada:\n" + p.legenda);
  const r = await db.postAgendado.update({ where: { id: ID }, data: { legenda: NOVA } });
  console.log("trocada |", r.status, r.agendadoPara.toISOString(), "\n" + r.legenda);
}
main().finally(() => db.$disconnect());
