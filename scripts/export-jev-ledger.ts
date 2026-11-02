/**
 * Exporta a tabela JevLedger para JSONL no formato do jev-ledger da OPI
 * (Lumio automation/jev-ledger/ledger.jsonl): processo "openreply.dm", sessao "OpenReply".
 *
 * Só lê o banco. Uso:
 *   npx tsx scripts/export-jev-ledger.ts [--saida <ledger.jsonl>] [--desde 2026-11-01]
 * Sem --saida, imprime no stdout. Com --saida, acrescenta só os ids que ainda não estão no arquivo
 * (o id é estável por linha do banco), então pode rodar toda semana sem duplicar.
 * Usa DATABASE_URL do ambiente; nunca imprime a URL.
 */
import "dotenv/config";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";
import { paraLinhaJsonl } from "../lib/opi/jev-gate";

function arg(nome: string): string | undefined {
  const i = process.argv.indexOf(nome);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória");
  const saida = arg("--saida");
  const desdeTxt = arg("--desde");
  const desde = desdeTxt ? new Date(desdeTxt) : undefined;
  if (desde && Number.isNaN(desde.getTime())) throw new Error("--desde inválido (use AAAA-MM-DD)");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }) });
  try {
    const linhas = await db.jevLedger.findMany({
      where: desde ? { createdAt: { gte: desde } } : {},
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
    const json = linhas.map(paraLinhaJsonl);
    if (!saida) {
      for (const l of json) process.stdout.write(JSON.stringify(l) + "\n");
      return;
    }
    const cru = existsSync(saida) ? readFileSync(saida, "utf8") : "";
    const ja = new Set<string>();
    for (const l of cru.split("\n")) {
      if (!l.trim()) continue;
      try { const j = JSON.parse(l); if (j && j.id) ja.add(String(j.id)); } catch { /* linha não-JSON fica intacta */ }
    }
    const novas = json.filter((l) => !ja.has(l.id));
    if (novas.length) {
      appendFileSync(saida, (cru && !cru.endsWith("\n") ? "\n" : "") + novas.map((l) => JSON.stringify(l) + "\n").join(""));
    }
    console.log(`ok: ${linhas.length} linhas no banco, ${novas.length} novas em ${saida}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
