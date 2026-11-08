// OPI: agenda 23 PUT (09/11 18h), 09 BINÁRIA (10/11 18h) e 08 INGRESSO (11/11 18h, "Sim, agenda o 08"), horário de São Paulo, com o "sim" do Luan ao
// calendário CALENDARIO-CENAS-NOV.md ("Sim, aprovo", 08/11) e a confirmação nesta sessão ("Sim, agenda").
// As legendas são lidas do próprio arquivo do calendário (blocos ``` de cada data), sem redigitar.
// Uso: npx tsx --env-file=C:/opi-work/openreply/.env scripts/opi-agenda-nov.ts
import { readFileSync } from "node:fs";
import { prisma } from "../lib/db/client";

const CAL = "C:/Users/luans/OneDrive/Área de Trabalho/OPI/company-os/04-growth/CALENDARIO-CENAS-NOV.md";
const AVISO = "Conteúdo educativo. Não é recomendação individual de investimento.";
const BASE = "https://opi-openreply.vercel.app/m/";

const ITENS = [
  { titulo: "## 09/11 — 23 PUT", video: "9ba33d8b1152fc33edbfe687.mp4", quando: "2026-11-09T21:00:00.000Z" },
  { titulo: "## 10/11 — 09 BINÁRIA", video: "6e4ddbc2c293c1fcf8884270.mp4", quando: "2026-11-10T21:00:00.000Z" },
  { titulo: "## 11/11 — 08 INGRESSO", video: "5fb8489ac90e72e8f527ca2f.mp4", quando: "2026-11-11T21:00:00.000Z" },
  { titulo: "## 14/11 — 21 APOSTA", video: "5adbb46f92404cd23cbd2b6e.mp4", quando: "2026-11-14T21:00:00.000Z" },
];

function legenda(md: string, titulo: string): string {
  const i = md.indexOf(titulo);
  if (i < 0) throw new Error(`não achei ${titulo}`);
  const a = md.indexOf("```", i);
  const b = md.indexOf("```", a + 3);
  const texto = md.slice(a + 3, b).replace(/^\r?\n/, "").replace(/\r\n/g, "\n").trimEnd();
  if (!texto.includes(AVISO)) throw new Error(`${titulo} sem o aviso obrigatório`);
  return texto;
}

async function main() {
  const md = readFileSync(CAL, "utf-8");
  if (!md.includes('APROVADO pelo Luan em 08/11/2026 ("Sim, aprovo")')) throw new Error("calendário sem a marca de aprovação");
  const conta = await prisma.instagramAccount.findFirstOrThrow({ where: { username: "opcoesparainvestidores" } });
  const ws = conta.workspaceId;
  for (const it of ITENS) {
    const res = await fetch(BASE + it.video, { method: "HEAD" });
    if (res.status !== 200 || !String(res.headers.get("content-type")).includes("video/mp4")) {
      throw new Error(`vídeo ainda não está público: ${it.video} (${res.status})`);
    }
    const leg = legenda(md, it.titulo);
    const dados = {
      workspaceId: ws, tipo: "REEL" as const, midias: [BASE + it.video], legenda: leg,
      agendadoPara: new Date(it.quando), status: "APROVADO" as const, aprovadoEm: new Date(),
      aprovadoPor: 'Luan (calendário "Sim, aprovo" + "Sim, agenda", 08/11/2026)',
    };
    const existente = await prisma.postAgendado.findFirst({ where: { workspaceId: ws, legenda: leg } });
    const p = existente
      ? await prisma.postAgendado.update({ where: { id: existente.id }, data: dados })
      : await prisma.postAgendado.create({ data: dados });
    const sp = p.agendadoPara.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
    console.log(`${it.titulo.slice(3)} -> ${p.id} ${p.status} | São Paulo: ${sp} | ${p.midias}`);
  }
  const ligado = await prisma.workspace.findUnique({ where: { id: ws }, select: { opiPublicadorLigado: true } });
  console.log("publicação automática ligada:", ligado?.opiPublicadorLigado);
}
main().finally(() => prisma.$disconnect());
