// OPI Central: popula um Postgres LOCAL descartável com dados de exemplo e cria uma sessão de teste,
// para ver o painel sem tocar no banco de produção. Recusa rodar fora de localhost.
// Uso: DATABASE_URL=postgresql://postgres:local@localhost:55432/opi npx tsx scripts/opi-seed-local.ts
import crypto from "node:crypto";
import { prisma } from "../lib/db/client";
import { ensureWorkspaceForUser } from "../lib/workspace";
import { hashTemplate } from "../lib/opi/jev-gate";

async function main() {
  if (!/localhost|127\.0\.0\.1/.test(process.env.DATABASE_URL ?? "")) throw new Error("só roda em banco local");
  const email = "teste.local@opi.test";
  const user = await prisma.user.upsert({ where: { email }, create: { email, name: "Luan (teste local)" }, update: {} });
  const ws = await ensureWorkspaceForUser(user.id, email);
  const token = crypto.randomBytes(24).toString("hex");
  await prisma.session.create({ data: { sessionToken: token, userId: user.id, expires: new Date(Date.now() + 7 * 864e5) } });

  const conta = await prisma.instagramAccount.upsert({
    where: { instagramId: "local-ig" },
    create: { workspaceId: ws.id, instagramId: "local-ig", username: "opcoesparainvestidores", accessToken: "local" },
    update: {},
  });
  const hoje = new Date();
  for (let i = 0; i < 14; i++) {
    const d = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate() - i));
    await prisma.followerSnapshot.create({ data: { instagramAccountId: conta.id, date: d, followersCount: 1240 - i * 6 } }).catch(() => {});
  }

  const redes: [string, Record<string, number>][] = [
    ["facebook", { seguidores: 312, alcance_7d: 1840 }],
    ["youtube", { inscritos: 95, visualizacoes_7d: 2100 }],
    ["tiktok", { seguidores: 430, visualizacoes_7d: 5200 }],
    ["meta_ads", { gasto_mes: 0, campanhas_ativas: 0 }],
  ];
  for (const [rede, metricas] of redes)
    await prisma.redeSnapshot.create({ data: { workspaceId: ws.id, rede, estado: "conectado", metricas } });

  const textos = [
    ["JUROS", "Aqui está o material sobre juros compostos nas opções. Conteúdo educativo. Não é recomendação individual de investimento."],
    ["ERROS", "Separei os 5 erros mais comuns de quem começa em opções. Conteúdo educativo. Não é recomendação individual de investimento."],
  ];
  for (const [palavra, dm] of textos) {
    await prisma.textoAprovado.upsert({
      where: { workspaceId_palavra: { workspaceId: ws.id, palavra } },
      create: { workspaceId: ws.id, palavra, dmMessage: dm, aprovadoPor: "Luan" },
      update: {},
    });
    const a = await prisma.automation.create({
      data: { workspaceId: ws.id, instagramAccountId: conta.id, name: `Reel ${palavra}`, keywords: [palavra], dmMessage: dm,
        publicReplyEnabled: true, publicReplyMessage: "Te mandei na DM! 📩", isActive: palavra === "JUROS" },
    });
    const n = palavra === "JUROS" ? 6 : 1;
    for (let i = 0; i < n; i++)
      await prisma.dmLog.create({ data: { workspaceId: ws.id, automationId: a.id, instagramAccountId: conta.id, commenterId: `c${palavra}${i}`,
        commenterName: `seguidor_${i + 1}`, commentText: palavra, commentId: `${palavra}-${i}`, status: "SENT", dmSentAt: new Date(),
        dmTemplateHash: hashTemplate(dm), jevDecision: "enviar" } });
    if (palavra === "JUROS")
      await prisma.dmLog.create({ data: { workspaceId: ws.id, automationId: a.id, instagramAccountId: conta.id, commenterId: "cx",
        commenterName: "seguidor_7", commentText: "JUROS quanto rende?", commentId: "JUROS-held", status: "HELD_FOR_REVIEW",
        jevDecision: "segurar", jevReason: "pergunta além da palavra" } });
  }

  const pedidos: [string, string, "FEITO" | "EM_ANDAMENTO" | "NOVO", string | null][] = [
    ["editor-de-videos", "Subi o vídeo 31 no Drive, pode começar a edição básica.", "EM_ANDAMENTO", null],
    ["roteirista-copywriter", "Escreve a legenda do Reel 01 TERMOS.", "FEITO", "Legenda pronta e revisada pela Compliance, com o aviso no fim."],
    ["social-distribuicao", "Monta a fila dos próximos 7 dias.", "NOVO", null],
  ];
  for (const [agente, mensagem, status, resposta] of pedidos)
    await prisma.pedidoAgente.create({ data: { workspaceId: ws.id, agente, mensagem, status, resposta,
      iniciadoEm: status !== "NOVO" ? new Date() : null, concluidoEm: status === "FEITO" ? new Date() : null } });

  const aviso = "Conteúdo educativo. Não é recomendação individual de investimento.";
  for (let i = 1; i <= 4; i++)
    await prisma.postAgendado.create({ data: { workspaceId: ws.id, tipo: i % 2 ? "REEL" : "CARROSSEL", midias: [],
      legenda: `Post de exemplo ${i}.\n\n${aviso}`, agendadoPara: new Date(Date.now() + i * 864e5), status: "RASCUNHO" } });

  const mes = new Date(); mes.setDate(5);
  await prisma.lancamento.create({ data: { workspaceId: ws.id, data: mes, tipo: "DESPESA", categoria: "Ferramentas", descricao: "Assinatura de exemplo", valor: 97, status: "PAGO" } });
  await prisma.lancamento.create({ data: { workspaceId: ws.id, data: mes, tipo: "DESPESA", categoria: "Hospedagem", descricao: "Servidor (exemplo)", valor: 45, status: "PREVISTO" } });

  console.log("SESSION_TOKEN=" + token);
}
main().finally(() => prisma.$disconnect());
