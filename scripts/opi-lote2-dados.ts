// OPI, lote 2 (10/11/2026), aprovado pelo Luan no plano e nas perguntas do dia:
//  1) desativa o texto e a campanha TESTE (não apaga);
//  2) cria texto + campanha de ESTRATEGIAS e COBERTA, presas aos posts agendados (molde da ERROS);
//  3) troca a legenda dos posts de 06/12 e 07/12 no mesmo registro.
// Textos de DM e legendas: literais do PARECER-NOV-2026 §25 (Compliance) e do "Sim" do Luan.
// O comparador de palavras ignora acento (foldDiacritics), então ESTRATEGIAS cobre "estratégias".
// Uso: npx tsx --env-file=C:/opi-work/openreply/.env scripts/opi-lote2-dados.ts
import { prisma as db } from "../lib/db/client";

const SITE = "https://opi-opcoes-para-investidores.vercel.app/materiais";
const L1 = "👋 Oi! Que bom ter você por aqui.";
const L3 = "📚 Conteúdo educativo. Não é recomendação individual de investimento.";
const AVISO = "Conteúdo educativo. Não é recomendação individual de investimento.";
const convite = (p: string) => `Comente ${p} que a OPI te manda o link do material gratuito na DM. Ele também está no site, no link da bio.`;

const ITENS = [
  {
    palavra: "ESTRATEGIAS",
    post: "cmw8pkk380000pohnupeur3fm",
    nome: "ESTRATEGIAS (Reel 02 · 06/12 · call, trava e straddle)",
    objetivo: "Entregar o PDF de call, trava de alta e straddle a quem comentar ESTRATEGIAS",
    dm: [L1, `📄 Seu material de call, trava de alta e straddle (para liberar, pedimos nome e WhatsApp): ${SITE}/estrategias.pdf?utm_source=instagram&utm_medium=dm&utm_campaign=OPI-REEL-011`, L3].join("\n"),
    antes: [
      "Call comprada, trava de alta e straddle comprado expressam cenários diferentes. O custo de entrada não resume o risco: prazo, volatilidade, liquidez e exercício também importam.",
      "Na compra de call, quem compra pode perder todo o prêmio pago.",
    ],
    tags: "#Opções #Derivativos #EducaçãoFinanceira #GestãoDeRisco",
  },
  {
    palavra: "COBERTA",
    post: "cmw8q21di0000a4hnddkdzgps",
    nome: "COBERTA (Reel 05 · 07/12 · três cenários da venda coberta)",
    objetivo: "Entregar o PDF dos três cenários hipotéticos da venda coberta a quem comentar COBERTA",
    dm: [L1, `📄 Seu material com três cenários hipotéticos da venda coberta, na alta, no lado e na queda (para liberar, pedimos nome e WhatsApp): ${SITE}/coberta.pdf?utm_source=instagram&utm_medium=dm&utm_campaign=OPI-REEL-015`, L3].join("\n"),
    antes: [
      "O prêmio recebido em uma venda coberta é um fluxo de caixa, não uma garantia de resultado positivo. O conjunto mantém risco de queda das ações, limita a participação na alta e pode levar à entrega das ações se houver exercício.",
    ],
    tags: "#VendaCoberta #Opções #Derivativos #EducaçãoFinanceira",
  },
];

async function main() {
  const conta = await db.instagramAccount.findFirstOrThrow({ where: { username: "opcoesparainvestidores" } });
  const ws = conta.workspaceId;

  // 1) TESTE
  const tt = await db.textoAprovado.updateMany({ where: { workspaceId: ws, palavra: "TESTE" }, data: { ativo: false } });
  const tc = await db.automation.updateMany({ where: { workspaceId: ws, keywords: { has: "TESTE" } }, data: { isActive: false, pendingNextReel: false } });
  console.log("TESTE desativada | textos", tt.count, "| campanhas", tc.count);

  const termos = await db.textoAprovado.findUniqueOrThrow({ where: { workspaceId_palavra: { workspaceId: ws, palavra: "TERMOS" } } });
  const RESPOSTA = termos.respostaPublica;

  for (const it of ITENS) {
    const antiga = [...it.antes, AVISO, it.tags].join("\n\n");
    const nova = [...it.antes, convite(it.palavra), AVISO, it.tags].join("\n\n");
    const post = await db.postAgendado.findUniqueOrThrow({ where: { id: it.post } });
    if (post.status !== "APROVADO") throw new Error(`${it.palavra}: status inesperado ${post.status}`);
    if (post.legenda !== nova && post.legenda.trim() !== antiga) throw new Error(`${it.palavra}: a legenda atual não é a esperada:\n${post.legenda}`);

    // 2) texto + campanha (antes da legenda: a legenda só promete a DM com a campanha no ar)
    const t = await db.textoAprovado.upsert({
      where: { workspaceId_palavra: { workspaceId: ws, palavra: it.palavra } },
      create: { workspaceId: ws, palavra: it.palavra, dmMessage: it.dm, respostaPublica: RESPOSTA, aprovadoPor: 'Luan ("Sim, com esses textos", 10/11/2026); Compliance PARECER-NOV-2026 §25' },
      update: { dmMessage: it.dm, respostaPublica: RESPOSTA, ativo: true },
    });
    const dados = {
      name: it.nome, goal: it.objetivo,
      postId: null, postUrl: "agendado:" + it.post, pendingNextReel: true, matchAnyPost: false,
      keywords: [it.palavra], matchAnyWord: false, wholeWordMatch: true, dmMessage: it.dm,
      publicReplyEnabled: true, publicReplyMessage: RESPOSTA, publicReplyMessages: [RESPOSTA],
      openingDmEnabled: false, requireFollow: false, followUpEnabled: false, dmTriggerEnabled: false, isActive: true,
    };
    const existente = await db.automation.findFirst({ where: { workspaceId: ws, keywords: { has: it.palavra } } });
    const a = existente
      ? await db.automation.update({ where: { id: existente.id }, data: dados })
      : await db.automation.create({ data: { ...dados, workspaceId: ws, instagramAccountId: conta.id } });
    console.log(it.palavra, "| texto ativo", t.ativo, "| campanha", a.id, "ativa", a.isActive, "alvo", a.postUrl);

    // 3) legenda
    if (post.legenda !== nova) await db.postAgendado.update({ where: { id: it.post }, data: { legenda: nova } });
    console.log(it.palavra, "| legenda nova no post", it.post);
  }
}
main().finally(() => db.$disconnect());
