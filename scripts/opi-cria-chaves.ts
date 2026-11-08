// OPI Central: cria as chaves de serviço do runner (agentes:rw) e do coletor das redes (redes:write)
// no workspace da OPI e grava os tokens como variáveis de ambiente do usuário Windows (setx), sem imprimir.
// Uso: npx tsx --env-file=C:/opi-work/openreply/.env scripts/opi-cria-chaves.ts
import { execFileSync } from "node:child_process";
import { prisma } from "../lib/db/client";
import { hashServiceToken, newServiceToken } from "../lib/integrations/auth";

const WORKSPACE = "cmvyzq5m50001s0hnejmuoyqp";
const CHAVES = [
  { nome: "OPI Central runner (PC do Luan)", escopo: "agentes:rw", env: "OPI_CENTRAL_KEY" },
  { nome: "OPI Central coletor de redes", escopo: "redes:write", env: "OPI_REDES_KEY" },
];

async function main() {
  for (const c of CHAVES) {
    const token = newServiceToken();
    const k = await prisma.serviceKey.create({
      data: { name: c.nome, scopes: [c.escopo], workspaceId: WORKSPACE, tokenHash: hashServiceToken(token), expiresAt: new Date(Date.now() + 90 * 864e5) },
      select: { id: true, expiresAt: true },
    });
    execFileSync("setx", [c.env, token], { stdio: "ignore" });
    console.log(`${c.escopo}: chave ${k.id} criada, válida até ${k.expiresAt?.toISOString().slice(0, 10)}, token em ${c.env}`);
  }
  execFileSync("setx", ["OPI_CENTRAL_URL", "https://opi-openreply.vercel.app"], { stdio: "ignore" });
  console.log("OPI_CENTRAL_URL definido");
}
main().finally(() => prisma.$disconnect());
