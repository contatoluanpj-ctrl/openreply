// OPI: confere no banco de produção se as tabelas do OPI Central existem (só leitura).
import { prisma } from "../lib/db/client";
async function main() {
  const r = await prisma.$queryRawUnsafe<{ t: string }[]>(`select table_name as t from information_schema.tables where table_name in ('RedeSnapshot','PedidoAgente','PostAgendado','Lancamento')`);
  console.log("tabelas:", r.map((x) => x.t).sort().join(", "));
}
main().finally(() => prisma.$disconnect());
