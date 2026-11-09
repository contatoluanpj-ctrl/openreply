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
  { titulo: "## 12/11 — 07 JUROS", video: "a6f1ff7ff20d0631b8ef200c.mp4", quando: "2026-11-12T21:00:00.000Z" },
  { titulo: "## 13/11 — 13 CHECKLIST", video: "c79f4266603c62e4827538bd.mp4", quando: "2026-11-13T21:00:00.000Z" },
  { titulo: "## 14/11 — 21 APOSTA", video: "5adbb46f92404cd23cbd2b6e.mp4", quando: "2026-11-14T21:00:00.000Z" },
  { titulo: "## 15/11 — 19 VENCIMENTO", video: "24f50803278f136675be2548.mp4", quando: "2026-11-15T21:00:00.000Z" },
  // 26 e 27: "Aprovo os dois" + "Sim, agenda" do Luan na sessão FOUNDER OPI (08/11).
  { titulo: "## 16/11 — 26 RISCO", video: "90c52420916cdc3e09fec205.mp4", quando: "2026-11-16T21:00:00.000Z" },
  { titulo: "## 17/11 — 27 LIVROSOPCOES", video: "75696916d1d509c416e20742.mp4", quando: "2026-11-17T21:00:00.000Z" },
  // Lote final (18/11 a 07/12): autorização do Luan na FOUNDER OPI ("já manda direto pra outra sessão, pra ela deixar
  // agendada") e nesta sessão ("ele vai mandar os vídeos para você já aprovados e deixar agendado tudo"), 08/11.
  { titulo: "## 18/11 — 03 ERROS", video: "00d3c1a0078dc6c16481ab92.mp4", quando: "2026-11-18T21:00:00.000Z" },
  { titulo: "## 19/11 — 06 LIVROS", video: "344b67384569a75629487891.mp4", quando: "2026-11-19T21:00:00.000Z" },
  { titulo: "## 20/11 — 04 PROTECAO", video: "f130a18305338a0219eec28d.mp4", quando: "2026-11-20T21:00:00.000Z" },
  { titulo: "## 22/11 — 12 EXERCICIO", video: "60af38097a42695a11aeb96c.mp4", quando: "2026-11-22T21:00:00.000Z" },
  { titulo: "## 23/11 — 17 LIQUIDEZ", video: "9b2f779314665436889564ca.mp4", quando: "2026-11-23T21:00:00.000Z" },
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
