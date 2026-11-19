import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { temAviso } from "@/lib/opi/aviso";
import { prepararDestinosNaAprovacao } from "@/lib/opi/destinos";
import { midiaDoNossoArmazenamento } from "@/lib/opi/midia";
import { LEGENDA_MAX } from "@/lib/opi/posts-schema";

/**
 * Entrada de posts pela esteira de vídeo (PC do Luan), por chave de serviço.
 *
 * Fluxo (D-0037 e D-0038): a esteira edita o vídeo, sobe a mídia (lib/opi/midia.ts), cria aqui um RASCUNHO e
 * mostra a prévia ao Luan no Telegram. Só depois do "sim" dele a esteira pede a aprovação, mandando o SELO
 * que recebeu na criação. O selo é o resumo do conteúdo (mídia, legenda, data, título): se qualquer coisa
 * mudou depois da prévia, o selo não bate e nada é aprovado. Quem publica é o worker, como em todo post.
 *
 * Travas:
 * - só Reel, com a mídia no nosso armazenamento e o aviso obrigatório na legenda;
 * - a chave só aprova ou descarta post que nasceu aqui (origem preenchida). Post criado ou editado no painel
 *   perde a origem e só sai pela aprovação do calendário;
 * - LinkedIn, X e Threads nunca entram por aqui (têm aprovação própria por destino).
 */
export const TITULO_YOUTUBE_MAX = 100;

export const ingestPostSchema = z
  .object({
    midia: z.string().trim().url(),
    legenda: z.string().trim().min(1).max(LEGENDA_MAX),
    tituloYoutube: z.string().trim().min(1).max(TITULO_YOUTUBE_MAX),
    /** Quando publicar. Sem data: sai assim que for aprovado. */
    agendadoPara: z.string().datetime({ offset: true }).optional(),
    /** De onde veio, só para leitura humana. Ex.: "noticia:N02_ANTHROPIC". */
    origem: z.string().trim().regex(/^[A-Za-z0-9_:.-]{1,80}$/, "origem inválida"),
  })
  .strict();
export type IngestPostInput = z.infer<typeof ingestPostSchema>;

export const ingestDecisaoSchema = z
  .object({
    acao: z.enum(["aprovar", "descartar"]),
    selo: z.string().regex(/^[0-9a-f]{64}$/),
    /** Quem disse "sim" e onde. Ex.: "telegram:msg-812". Fica gravado no post. */
    aprovadoPor: z.string().trim().regex(/^[A-Za-z0-9_:.@ -]{3,100}$/, "aprovadoPor inválido").optional(),
  })
  .strict();
export type IngestDecisao = z.infer<typeof ingestDecisaoSchema>;

export class IngestErro extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "IngestErro";
  }
}

type Env = Record<string, string | undefined>;
export type DbIngest = Pick<PrismaClient, "postAgendado" | "postDestino">;

export type ConteudoDoSelo = {
  tipo: string;
  midias: unknown;
  legenda: string;
  agendadoPara: Date | string;
  tituloYoutube: string | null;
  origem: string | null;
};

/** Resumo (SHA-256) do que o Luan viu na prévia. Qualquer mudança no post muda o selo. */
export function seloDoPost(c: ConteudoDoSelo): string {
  const canonico = JSON.stringify([
    c.tipo,
    Array.isArray(c.midias) ? c.midias : [],
    c.legenda.normalize("NFC"),
    new Date(c.agendadoPara).toISOString(),
    (c.tituloYoutube ?? "").normalize("NFC"),
    c.origem ?? "",
  ]);
  return createHash("sha256").update(canonico, "utf8").digest("hex");
}

function conferirConteudo(midia: string, legenda: string, env: Env) {
  if (!/\.mp4$/i.test(new URL(midia).pathname)) throw new IngestErro("A mídia precisa ser um vídeo mp4");
  if (!midiaDoNossoArmazenamento(midia, env)) throw new IngestErro("A mídia precisa estar no armazenamento do painel");
  if (!temAviso(legenda)) throw new IngestErro("Legenda sem o aviso obrigatório");
}

/** Cria o RASCUNHO do Reel e os destinos dele. Nada é publicado: rascunho não sai. */
export async function criarRascunhoIngest(
  db: DbIngest,
  workspaceId: string,
  input: IngestPostInput,
  deps: { env?: Env; agora?: () => Date } = {},
): Promise<{ id: string; selo: string; agendadoPara: string; destinos: string[] }> {
  const env = deps.env ?? process.env;
  const agora = (deps.agora ?? (() => new Date()))();
  conferirConteudo(input.midia, input.legenda, env);
  const agendadoPara = input.agendadoPara ? new Date(input.agendadoPara) : agora;
  if (input.agendadoPara && agendadoPara.getTime() <= agora.getTime()) throw new IngestErro("Data e hora já passaram");

  const post = await db.postAgendado.create({
    data: {
      workspaceId,
      tipo: "REEL",
      midias: [input.midia],
      legenda: input.legenda,
      agendadoPara,
      status: "RASCUNHO",
      origem: input.origem,
    },
    select: { id: true },
  });
  await prepararDestinosNaAprovacao(db, [{ id: post.id, tipo: "REEL" }], env);
  await db.postDestino.updateMany({ where: { postId: post.id, rede: "youtube" }, data: { titulo: input.tituloYoutube } });
  const destinos = await db.postDestino.findMany({ where: { postId: post.id }, select: { rede: true }, orderBy: { rede: "asc" } });
  return {
    id: post.id,
    selo: seloDoPost({
      tipo: "REEL",
      midias: [input.midia],
      legenda: input.legenda,
      agendadoPara,
      tituloYoutube: input.tituloYoutube,
      origem: input.origem,
    }),
    agendadoPara: agendadoPara.toISOString(),
    destinos: destinos.map((d) => d.rede),
  };
}

/** Aprova (com o selo da prévia) ou descarta um rascunho que nasceu na esteira. */
export async function decidirIngest(
  db: DbIngest,
  workspaceId: string,
  id: string,
  decisao: IngestDecisao,
  deps: { env?: Env; agora?: () => Date } = {},
): Promise<{ id: string; status: "APROVADO" | "DESCARTADO"; agendadoPara?: string }> {
  const env = deps.env ?? process.env;
  const agora = (deps.agora ?? (() => new Date()))();
  const post = await db.postAgendado.findFirst({
    where: { id, workspaceId },
    select: {
      id: true,
      tipo: true,
      midias: true,
      legenda: true,
      agendadoPara: true,
      status: true,
      origem: true,
      updatedAt: true,
      destinos: { select: { rede: true, titulo: true } },
    },
  });
  if (!post) throw new IngestErro("Post não encontrado", 404);
  if (!post.origem) throw new IngestErro("Este post não veio da esteira; aprove pelo calendário do painel", 403);
  if (post.status !== "RASCUNHO") throw new IngestErro("O post não está mais em rascunho", 409);

  const tituloYoutube = post.destinos.find((d) => d.rede === "youtube")?.titulo ?? null;
  const seloAtual = seloDoPost({ ...post, tituloYoutube });
  if (seloAtual !== decisao.selo) throw new IngestErro("O post mudou depois da prévia. Mostre a prévia de novo.", 409);

  // A guarda por updatedAt fecha a janela entre a leitura e a escrita: se alguém editou no meio, nada muda.
  const guarda = { id, workspaceId, status: "RASCUNHO" as const, updatedAt: post.updatedAt };
  if (decisao.acao === "descartar") {
    const apagado = await db.postAgendado.deleteMany({ where: guarda });
    if (apagado.count !== 1) throw new IngestErro("O post mudou. Nada foi apagado.", 409);
    return { id, status: "DESCARTADO" };
  }

  if (!decisao.aprovadoPor) throw new IngestErro("Informe quem aprovou (aprovadoPor)");
  if (post.tipo !== "REEL") throw new IngestErro("Só Reel é aprovado por aqui", 403);
  const midias = Array.isArray(post.midias) ? post.midias : [];
  if (midias.length !== 1 || typeof midias[0] !== "string") throw new IngestErro("Reel leva exatamente 1 vídeo");
  conferirConteudo(midias[0], post.legenda, env);

  const agendadoPara = post.agendadoPara.getTime() < agora.getTime() ? agora : post.agendadoPara;
  // Destinos antes do status, como na aprovação do mês: o post nunca fica aprovado sem ter para onde ir.
  await prepararDestinosNaAprovacao(db, [{ id, tipo: "REEL" }], env);
  const aprovado = await db.postAgendado.updateMany({
    where: guarda,
    data: { status: "APROVADO", aprovadoEm: agora, aprovadoPor: `esteira:${decisao.aprovadoPor}`, agendadoPara },
  });
  if (aprovado.count !== 1) throw new IngestErro("O post mudou. Nada foi aprovado.", 409);
  return { id, status: "APROVADO", agendadoPara: agendadoPara.toISOString() };
}
