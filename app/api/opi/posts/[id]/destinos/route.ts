import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";
import { temAviso } from "@/lib/opi/aviso";
import { REDES_APROVACAO_PROPRIA, REDES_DESTINO, SELECT_DESTINO, paraDestinosView } from "@/lib/opi/destinos";

export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ id: string }> };

const texto = (max: number) => z.string().trim().max(max).nullable();

const corpoSchema = z
  .object({
    rede: z.enum(REDES_DESTINO),
    titulo: texto(300).optional(),
    descricao: texto(5000).optional(),
    /** Aprovação própria do destino (obrigatória para linkedin e x). */
    aprovar: z.boolean().optional(),
    /** Devolve para a fila um destino que falhou ou foi pulado. */
    tentarDeNovo: z.boolean().optional(),
  })
  .strict();

/** Destino em publicação ou já publicado não muda mais: nunca se publica duas vezes. */
const FECHADOS = ["PUBLICANDO", "PUBLICADO"] as const;

/** GET /api/opi/posts/[id]/destinos — destinos do post (uma rede cada), com status e link. */
export async function GET(_request: Request, { params }: RouteProps) {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await params;
  const post = await prisma.postAgendado.findFirst({
    where: { id, workspaceId: ctx.workspaceId },
    select: { id: true, destinos: { select: SELECT_DESTINO } },
  });
  if (!post) return NextResponse.json({ error: "Post não encontrado" }, { status: 404 });
  return NextResponse.json({ destinos: paraDestinosView(post.destinos) });
}

/**
 * POST /api/opi/posts/[id]/destinos { rede, titulo?, descricao?, aprovar?, tentarDeNovo? }
 * Cria ou ajusta o destino de uma rede neste post. É o único caminho para linkedin e x, que o
 * publicador nunca cria sozinho e só publica depois de `aprovar: true`. Mudar o texto de um destino
 * com aprovação própria derruba a aprovação (como editar um post aprovado, D-0026).
 */
export async function POST(request: Request, { params }: RouteProps) {
  const ctx = await getCurrentWorkspaceContext();
  if (!ctx) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  if (!canManageWorkspace(ctx.role)) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const { id } = await params;

  const parsed = corpoSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Dados inválidos", issues: parsed.error.issues },
      { status: 400 },
    );
  }
  const { rede, titulo, descricao, aprovar, tentarDeNovo } = parsed.data;
  if (descricao && !temAviso(descricao)) {
    return NextResponse.json({ error: "Descrição sem o aviso obrigatório" }, { status: 422 });
  }

  const post = await prisma.postAgendado.findFirst({ where: { id, workspaceId: ctx.workspaceId }, select: { id: true } });
  if (!post) return NextResponse.json({ error: "Post não encontrado" }, { status: 404 });

  const chave = { postId_rede: { postId: id, rede } };
  const existente = await prisma.postDestino.findUnique({ where: chave, select: { id: true, status: true } });
  if (existente && (FECHADOS as readonly string[]).includes(existente.status)) {
    return NextResponse.json({ error: "Destino em publicação ou já publicado não pode ser alterado" }, { status: 409 });
  }

  const dados: {
    titulo?: string | null;
    descricao?: string | null;
    aprovadoEm?: Date | null;
    aprovadoPor?: string | null;
    status?: "PENDENTE";
    erro?: null;
    tentativas?: number;
  } = {};
  if (titulo !== undefined) dados.titulo = titulo || null;
  if (descricao !== undefined) dados.descricao = descricao || null;
  const mudouTexto = titulo !== undefined || descricao !== undefined;
  if (aprovar === true) {
    const usuario = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } });
    dados.aprovadoEm = new Date();
    dados.aprovadoPor = usuario?.email ?? ctx.userId;
  } else if (aprovar === false || (mudouTexto && (REDES_APROVACAO_PROPRIA as readonly string[]).includes(rede))) {
    dados.aprovadoEm = null;
    dados.aprovadoPor = null;
  }
  if (tentarDeNovo === true && existente && (existente.status === "ERRO" || existente.status === "PULADO")) {
    dados.status = "PENDENTE";
    dados.erro = null;
    dados.tentativas = 0;
  }

  if (existente) {
    // A trava pelo status evita mexer no destino que o publicador acabou de pegar.
    const r = await prisma.postDestino.updateMany({
      where: { id: existente.id, status: { notIn: [...FECHADOS] } },
      data: dados,
    });
    if (r.count === 0) {
      return NextResponse.json({ error: "Destino em publicação ou já publicado não pode ser alterado" }, { status: 409 });
    }
  } else {
    await prisma.postDestino.createMany({ data: [{ postId: id, rede, ...dados }], skipDuplicates: true });
  }
  const destino = await prisma.postDestino.findUnique({ where: chave, select: SELECT_DESTINO });
  return NextResponse.json({ destino: destino ? paraDestinosView([destino])[0] : null }, { status: existente ? 200 : 201 });
}
