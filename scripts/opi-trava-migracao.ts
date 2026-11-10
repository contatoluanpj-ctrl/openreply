// OPI: mostra quem segura a trava de migração do Prisma (pg_advisory_lock 72707369). SÓ LEITURA.
// Uso: npx tsx --env-file=C:/opi-work/openreply/.env scripts/opi-trava-migracao.ts
import { prisma as db } from "../lib/db/client";
async function main() {
  const r = await db.$queryRawUnsafe<Record<string, unknown>[]>(
    `select l.pid, l.granted, a.state, a.application_name, a.backend_start, a.state_change, left(a.query, 80) as query
       from pg_locks l left join pg_stat_activity a on a.pid = l.pid
      where l.locktype = 'advisory' and l.objid = 72707369`,
  );
  console.log(JSON.stringify(r, null, 1));
}
main().finally(() => db.$disconnect());
