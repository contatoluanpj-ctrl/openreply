// URL do banco para o Prisma CLI (prisma.config.ts): a conexão DIRETA do Neon.
// Pelo pooler (pgbouncer, host com "-pooler.") a trava de migração (advisory lock) fica presa e o
// `prisma migrate deploy` trava. Função pura, sem dependências: o prisma.config.ts roda fora do Next.
// Não é usada pelo cliente de runtime (lib/db/client), que segue com a DATABASE_URL do pooler.

type Env = Record<string, string | undefined>;

/** Tira o "-pooler." do host (ep-xxx-pooler.regiao.aws.neon.tech -> ep-xxx.regiao.aws.neon.tech). */
export function semPooler(url: string): string {
  const m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i.exec(url);
  if (!m) return url;
  const [, esquema, autoridade, resto] = m;
  // Só o host: usuário e senha (antes do último "@") ficam intactos.
  const arroba = autoridade.lastIndexOf("@");
  const credenciais = autoridade.slice(0, arroba + 1);
  const host = autoridade.slice(arroba + 1).replace("-pooler.", ".");
  return `${esquema}${credenciais}${host}${resto}`;
}

/** DIRECT_URL quando existir, senão DATABASE_URL; nos dois casos sem o trecho do pooler. */
export function urlDoPrismaCli(env: Env): string | undefined {
  const url = (env.DIRECT_URL ?? "").trim() || (env.DATABASE_URL ?? "").trim();
  return url ? semPooler(url) : undefined;
}
