// OPI: cria/atualiza o destino "youtube" (título e descrição do Short) nos Reels aprovados do calendário,
// a partir do plano de Shorts (JSON com id, video, publishAt, titulo, descricao, bloqueado).
//
// Não publica nada: só grava PostDestino. Quem publica é o publicador, quando o post chega na hora
// (agendadoPara do post, não o publishAt do plano) e o Composio está configurado.
//
// Por padrão é SIMULAÇÃO (--dry-run): mostra o que faria e não grava. Para gravar, passe --aplicar.
// Uso:
//   npx tsx --env-file=<arquivo .env> scripts/opi-destinos-shorts.ts [caminho-do-plano.json] [--aplicar] [--incluir-passados] [--workspace=<id>]
//
// Casamento plano -> post: primeiro pelo id do item (se for o id de um PostAgendado do workspace); senão,
// pelo Reel aprovado do mesmo dia (fuso de São Paulo), desempatando pela URL do vídeo. Item `bloqueado`,
// sem título, com título acima de 100 caracteres ou com descrição sem o aviso obrigatório é pulado.
// Post cuja hora já passou também é pulado: criar o destino ali faria o publicador subir o Short na rodada
// seguinte (e o vídeo pode já estar no YouTube por outro caminho). Para incluir, passe --incluir-passados.
import { readFileSync } from "node:fs";
import { prisma } from "../lib/db/client";
import { temAviso } from "../lib/opi/aviso";
import { diaSP } from "../lib/opi/posts-schema";
import { YOUTUBE_TITULO_MAX } from "../lib/opi/publicadores/youtube";

const PLANO_PADRAO = "C:/Users/luans/OneDrive/Área de Trabalho/OPI/conteudo/youtube/shorts-plano.json";
const SEM_TITULO = "YouTube sem título";

export type ItemPlano = {
  id?: string;
  video?: string;
  publishAt?: string;
  titulo?: string;
  descricao?: string;
  bloqueado?: boolean;
};

export type PostDoPlano = {
  id: string;
  agendadoPara: Date;
  midias: unknown;
  destinos: Array<{ id: string; rede: string; status: string; erro: string | null; titulo: string | null; descricao: string | null }>;
};

export type Decisao =
  | { acao: "pular"; motivo: string }
  | { acao: "criar" | "atualizar" | "igual"; postId: string; destinoId?: string; liberar: boolean };

/** Decide o que fazer com um item do plano. Função pura, para a simulação e a gravação darem o mesmo resultado. */
export function decidir(
  item: ItemPlano,
  posts: PostDoPlano[],
  opcoes: { agora?: Date; incluirPassados?: boolean } = {},
): Decisao {
  if (item.bloqueado) return { acao: "pular", motivo: "bloqueado no plano" };
  const titulo = (item.titulo ?? "").trim();
  const descricao = (item.descricao ?? "").trim();
  if (!titulo) return { acao: "pular", motivo: "sem título" };
  if (titulo.length > YOUTUBE_TITULO_MAX) return { acao: "pular", motivo: `título com mais de ${YOUTUBE_TITULO_MAX} caracteres` };
  if (!temAviso(descricao)) return { acao: "pular", motivo: "descrição sem o aviso obrigatório" };

  let post = item.id ? posts.find((p) => p.id === item.id) : undefined;
  if (!post) {
    if (!item.publishAt || Number.isNaN(new Date(item.publishAt).getTime())) return { acao: "pular", motivo: "sem publishAt válido" };
    const dia = diaSP(item.publishAt);
    let doDia = posts.filter((p) => diaSP(p.agendadoPara) === dia);
    if (doDia.length > 1 && item.video) {
      doDia = doDia.filter((p) => Array.isArray(p.midias) && p.midias[0] === item.video);
    }
    if (doDia.length === 0) return { acao: "pular", motivo: `nenhum Reel aprovado em ${dia}` };
    if (doDia.length > 1) return { acao: "pular", motivo: `mais de um Reel aprovado em ${dia}` };
    post = doDia[0];
  }

  if (!opcoes.incluirPassados && post.agendadoPara.getTime() <= (opcoes.agora ?? new Date()).getTime()) {
    return { acao: "pular", motivo: "a hora do post já passou (use --incluir-passados se for mesmo o caso)" };
  }

  const destino = post.destinos.find((d) => d.rede === "youtube");
  if (!destino) return { acao: "criar", postId: post.id, liberar: false };
  if (destino.status === "PUBLICADO" || destino.status === "PUBLICANDO") {
    return { acao: "pular", motivo: "YouTube já publicado ou em publicação" };
  }
  // Só volta para a fila sozinho o destino que parou por falta de título; outra falha pede o "tentar de novo" do Luan.
  const liberar = destino.status === "ERRO" && (destino.erro ?? "").startsWith(SEM_TITULO);
  const igual = destino.titulo === titulo && destino.descricao === descricao && !liberar;
  return { acao: igual ? "igual" : "atualizar", postId: post.id, destinoId: destino.id, liberar };
}

async function main() {
  const args = process.argv.slice(2);
  const aplicar = args.includes("--aplicar") && !args.includes("--dry-run");
  const caminho = args.find((a) => !a.startsWith("--")) ?? PLANO_PADRAO;
  const incluirPassados = args.includes("--incluir-passados");
  const wsArg = args.find((a) => a.startsWith("--workspace="))?.slice("--workspace=".length);

  const plano = JSON.parse(readFileSync(caminho, "utf8")) as ItemPlano[];
  if (!Array.isArray(plano)) throw new Error("O plano precisa ser uma lista");

  const ws =
    wsArg ??
    (await prisma.instagramAccount.findFirstOrThrow({ where: { username: "opcoesparainvestidores" }, select: { workspaceId: true } }))
      .workspaceId;

  const posts = await prisma.postAgendado.findMany({
    where: { workspaceId: ws, tipo: "REEL", aprovadoEm: { not: null }, status: { in: ["APROVADO", "PUBLICANDO", "PUBLICADO"] } },
    orderBy: [{ agendadoPara: "asc" }, { id: "asc" }],
    select: {
      id: true,
      agendadoPara: true,
      midias: true,
      destinos: { select: { id: true, rede: true, status: true, erro: true, titulo: true, descricao: true } },
    },
  });

  console.log(`${aplicar ? "GRAVANDO" : "SIMULAÇÃO (nada é gravado; use --aplicar)"} | itens no plano: ${plano.length} | Reels aprovados: ${posts.length}`);
  const conta = { criar: 0, atualizar: 0, igual: 0, pular: 0 };
  for (const item of plano) {
    const d = decidir(item, posts, { incluirPassados });
    conta[d.acao]++;
    const rotulo = `${(item.publishAt ?? "").slice(0, 10)} "${(item.titulo ?? "").slice(0, 50)}"`;
    if (d.acao === "pular") {
      console.log(`pular     ${rotulo}: ${d.motivo}`);
      continue;
    }
    console.log(`${d.acao.padEnd(9)} ${rotulo} -> post ${d.postId}${d.liberar ? " (volta para a fila)" : ""}`);
    if (!aplicar || d.acao === "igual") continue;
    const dados = { titulo: (item.titulo ?? "").trim(), descricao: (item.descricao ?? "").trim() };
    if (d.acao === "criar") {
      await prisma.postDestino.createMany({ data: [{ postId: d.postId, rede: "youtube", ...dados }], skipDuplicates: true });
    } else {
      await prisma.postDestino.updateMany({
        where: { id: d.destinoId, status: { notIn: ["PUBLICANDO", "PUBLICADO"] } },
        data: d.liberar ? { ...dados, status: "PENDENTE", erro: null, tentativas: 0 } : dados,
      });
    }
  }
  console.log(`resumo: criar ${conta.criar}, atualizar ${conta.atualizar}, sem mudança ${conta.igual}, pulados ${conta.pular}`);
}

// Só roda quando chamado direto (o teste importa `decidir`).
if (process.argv[1] && /opi-destinos-shorts\.ts$/.test(process.argv[1].replace(/\\/g, "/"))) {
  main()
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
