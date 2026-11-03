/**
 * Amostra semanal para a Compliance da OPI (PARECER-NOV-2026 §8.2-6): 10% das DMs automáticas enviadas no
 * período (no mínimo 1), sorteadas, com o que é preciso para conferir cada envio: data, comment_id, campanha,
 * palavra, texto aprovado usado (pelo hash), p do Jev e se a resposta pública saiu. Inclui o total de casos
 * segurados por decisão.
 *
 * Só lê o banco. Não traz @usuário nem o texto do comentário (a Compliance abre o comentário pelo id). Uso:
 *   npx tsx scripts/amostra-compliance.ts [--desde 2026-11-02] [--ate 2026-11-09] [--saida amostra.md]
 * Sem --desde: últimos 7 dias. Usa DATABASE_URL do ambiente; nunca imprime a URL.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";
import { TEXTOS_DM_APROVADOS, hashTemplate } from "../lib/opi/jev-gate";

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i > 0 ? process.argv[i + 1] : undefined;
}

function data(txt: string | undefined, padrao: Date): Date {
  if (!txt) return padrao;
  const d = new Date(txt);
  if (Number.isNaN(d.getTime())) throw new Error(`data inválida: ${txt} (use AAAA-MM-DD)`);
  return d;
}

// Rótulo legível de cada texto aprovado: palavra e fase (A = link direto, B = página com formulário).
const ROTULO_TEMPLATE = new Map(TEXTOS_DM_APROVADOS.map((t) => {
  const tema = t.includes("/materiais/juros") ? "JUROS" : t.includes("/materiais/erros") ? "ERROS" : "?";
  return [hashTemplate(t), `${tema} fase ${t.includes(".pdf?") ? "A" : "B"}`];
}));

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória");
  const ate = data(arg("--ate"), new Date());
  const desde = data(arg("--desde"), new Date(ate.getTime() - 7 * 86400_000));
  const saida = arg("--saida");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }) });
  try {
    const enviados = await db.dmLog.findMany({
      where: { status: "SENT", dmSentAt: { gte: desde, lt: ate } },
      select: {
        commentId: true, dmSentAt: true, matchedKeyword: true, dmTemplateHash: true, jevScores: true,
        publicReplySentAt: true, automation: { select: { name: true } },
      },
      orderBy: { dmSentAt: "asc" },
    });
    const segurados = await db.dmLog.groupBy({
      by: ["jevDecision"],
      where: { status: "HELD_FOR_REVIEW", createdAt: { gte: desde, lt: ate } },
      _count: { _all: true },
    });

    const n = enviados.length ? Math.max(1, Math.ceil(enviados.length * 0.1)) : 0;
    const sorteio = [...enviados].sort(() => Math.random() - 0.5).slice(0, n)
      .sort((a, b) => (a.dmSentAt?.getTime() ?? 0) - (b.dmSentAt?.getTime() ?? 0));

    const linhas = [
      `# Amostra da Compliance: DMs automáticas da OPI`,
      ``,
      `Período: ${desde.toISOString().slice(0, 10)} a ${ate.toISOString().slice(0, 10)}. Enviadas: ${enviados.length}. Amostra (10%, mín. 1): ${n}.`,
      ``,
      `| Enviada em | comment_id | Campanha | Palavra | Texto usado | p do Jev | Resposta pública |`,
      `|---|---|---|---|---|---|---|`,
      ...sorteio.map((d) => {
        const tpl = d.dmTemplateHash ? (ROTULO_TEMPLATE.get(d.dmTemplateHash) ?? `NÃO APROVADO (${d.dmTemplateHash})`) : "sem registro";
        const p = d.jevScores ? JSON.stringify(d.jevScores) : "—";
        return `| ${d.dmSentAt?.toISOString() ?? "—"} | ${d.commentId} | ${d.automation?.name ?? "—"} | ${d.matchedKeyword ?? "—"} | ${tpl} | ${p} | ${d.publicReplySentAt ? "sim" : "não"} |`;
      }),
      ``,
      `Segurados no período (não receberam nada automático): ` +
        (segurados.length ? segurados.map((s) => `${s.jevDecision ?? "sem decisão"}: ${s._count._all}`).join("; ") : "nenhum") + ".",
      ``,
      `Conferir em cada linha: texto idêntico ao DM-TEXTOS, aviso presente, link certo, comentário era só a palavra.`,
    ];
    const md = linhas.join("\n") + "\n";
    if (saida) writeFileSync(saida, md);
    else process.stdout.write(md);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
