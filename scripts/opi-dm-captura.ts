// OPI: DM curta quando o link do material passa a abrir o formulário (captura ligada, 08/11/2026).
// Texto literal de CAPTURA-WHATSAPP-OBRIGATORIO §4 (Compliance): "(para liberar, pedimos nome e WhatsApp)".
// Atualiza o TextoAprovado e a campanha de TERMOS e JUROS juntos (o portão do Jev compara os dois).
// Uso: npx tsx --env-file=C:/opi-work/openreply/.env scripts/opi-dm-captura.ts
import { prisma } from "../lib/db/client";

const SITE = "https://opi-opcoes-para-investidores.vercel.app/materiais";
const L1 = "👋 Oi! Que bom ter você por aqui.";
const L3 = "📚 Conteúdo educativo. Não é recomendação individual de investimento.";
const DMS: Record<string, string> = {
  TERMOS: [L1, `📄 Seu material dos 15 termos de opções (para liberar, pedimos nome e WhatsApp): ${SITE}/termos.pdf?utm_source=instagram&utm_medium=dm&utm_campaign=OPI-REEL-013`, L3].join("\n"),
  JUROS: [L1, `📄 Seu mapa da Selic ao seu bolso (para liberar, pedimos nome e WhatsApp): ${SITE}/juros.pdf?utm_source=instagram&utm_medium=dm&utm_campaign=OPI-REEL-017`, L3].join("\n"),
};

async function main() {
  const conta = await prisma.instagramAccount.findFirstOrThrow({ where: { username: "opcoesparainvestidores" } });
  const ws = conta.workspaceId;
  for (const [palavra, dm] of Object.entries(DMS)) {
    const t = await prisma.textoAprovado.update({
      where: { workspaceId_palavra: { workspaceId: ws, palavra } },
      data: { dmMessage: dm },
    });
    const a = await prisma.automation.updateMany({ where: { workspaceId: ws, keywords: { has: palavra } }, data: { dmMessage: dm } });
    console.log(palavra, "texto ativo", t.ativo, "| campanhas atualizadas", a.count);
  }
}
main().finally(() => prisma.$disconnect());
