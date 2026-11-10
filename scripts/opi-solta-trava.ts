// OPI: solta a trava de migração do Prisma (72707369) que ficou presa numa conexão do pgbouncer do Neon.
// Autorizado pelo Luan em 10/11/2026. Só usar com NENHUM build/migração rodando.
// Não derruba conexão: só pg_advisory_unlock na conexão que a segura.
// Uso: npx tsx --env-file=C:/opi-work/openreply/.env scripts/opi-solta-trava.ts
import { prisma as db } from "../lib/db/client";
const presas = () => db.$queryRawUnsafe<{ pid: number }[]>(`select pid from pg_locks where locktype='advisory' and objid=72707369 and granted`);
async function main() {
  for (let i = 0; i < 20; i++) {
    const antes = await presas();
    if (antes.length === 0) return console.log("trava livre (tentativa " + i + ")");
    const r = await db.$queryRawUnsafe<{ pid: number; soltou: boolean }[]>(`select pg_backend_pid() as pid, pg_advisory_unlock(72707369) as soltou`);
    console.log("presa em", antes.map((x) => x.pid).join(","), "| tentei em", r[0].pid, "soltou:", r[0].soltou);
  }
  console.log("ainda presa:", JSON.stringify(await presas()));
}
main().finally(() => db.$disconnect());
