/**
 * Importa para o Financeiro do OPI Central os custos já registrados no company-os da OPI.
 *
 * Fonte (só leitura, sem rede):
 *   - company-os/02-governance/DECISION_LOG.md, GASTO-001 (Kairogen Pro, R$149/mês,
 *     assinada em 27/09/2026; 2ª mensalidade em 27/10/2026 [CONFIRMAR no extrato];
 *     o Luan cancela antes de 27/11, por isso não há lançamento de 27/11).
 *   - company-os/08-agents/reports/cfo/RAIO-X-CFO-2026-10-30.md (demais ferramentas a R$0
 *     ou com preço a verificar: não viram lançamento). Receita registrada: R$0.
 *
 * NÃO roda sozinho em produção. Padrão é --dry-run (só mostra). Para gravar:
 *   OPI_WORKSPACE_ID=<id> npx tsx scripts/opi-seed-financeiro.ts --apply
 * Idempotente: procura workspaceId + data + descrição antes de criar.
 * Usa DATABASE_URL do ambiente; nunca imprime a URL.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../app/generated/prisma/client";

type Semente = {
  data: string;
  tipo: "RECEITA" | "DESPESA";
  categoria: string;
  descricao: string;
  valor: string;
  status: "PREVISTO" | "PAGO";
};

export const SEMENTES: Semente[] = [
  {
    data: "2026-09-27",
    tipo: "DESPESA",
    categoria: "Ferramentas IA",
    descricao: "Kairogen Pro — 1ª mensalidade (GASTO-001)",
    valor: "149.00",
    status: "PAGO",
  },
  {
    data: "2026-10-27",
    tipo: "DESPESA",
    categoria: "Ferramentas IA",
    descricao: "Kairogen Pro — 2ª mensalidade (GASTO-001) [CONFIRMAR no extrato]",
    valor: "149.00",
    status: "PAGO",
  },
];

async function main() {
  const aplicar = process.argv.includes("--apply");
  const workspaceId = process.env.OPI_WORKSPACE_ID?.trim();
  if (!workspaceId) throw new Error("OPI_WORKSPACE_ID é obrigatório");

  if (!aplicar) {
    console.log(`[dry-run] ${SEMENTES.length} lançamentos para o workspace ${workspaceId}:`);
    for (const s of SEMENTES) console.log(`  ${s.data} ${s.tipo} R$${s.valor} ${s.status} — ${s.descricao}`);
    console.log("Nada gravado. Rode com --apply para gravar.");
    return;
  }

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("DATABASE_URL é obrigatória");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, max: 1 }) });
  try {
    let criados = 0;
    for (const s of SEMENTES) {
      const data = new Date(`${s.data}T12:00:00.000Z`);
      const existe = await db.lancamento.findFirst({
        where: { workspaceId, data, descricao: s.descricao },
        select: { id: true },
      });
      if (existe) {
        console.log(`  já existe: ${s.data} — ${s.descricao}`);
        continue;
      }
      await db.lancamento.create({
        data: {
          workspaceId,
          data,
          tipo: s.tipo,
          categoria: s.categoria,
          descricao: s.descricao,
          valor: s.valor,
          status: s.status,
        },
      });
      criados += 1;
      console.log(`  criado: ${s.data} — ${s.descricao}`);
    }
    console.log(`${criados} lançamento(s) criado(s).`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
