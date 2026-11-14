// Destinos nas rotas (calendário, aprovação do mês, destino por rede, Redes) e no script do plano de Shorts.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, auth, access } = vi.hoisted(() => ({
  mockPrisma: {
    postAgendado: { findMany: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    postDestino: { createMany: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn(), groupBy: vi.fn() },
    redeSnapshot: { findMany: vi.fn() },
    followerSnapshot: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
    $disconnect: vi.fn(),
  },
  auth: { getCurrentWorkspaceId: vi.fn() },
  access: { getCurrentWorkspaceContext: vi.fn() },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("../lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => auth);
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: access.getCurrentWorkspaceContext,
  canManageWorkspace: (role: string) => role === "ADMIN" || role === "OWNER",
}));

import { GET as LISTAR } from "@/app/api/opi/posts/route";
import { POST as APROVAR } from "@/app/api/opi/posts/aprovar-mes/route";
import { GET as DESTINOS, POST as DESTINO } from "@/app/api/opi/posts/[id]/destinos/route";
import { GET as REDES } from "@/app/api/opi/redes/route";
import { AVISO_OBRIGATORIO } from "@/lib/opi/aviso";
import { montarRedes } from "@/lib/opi/redes";
import { decidir, type PostDoPlano } from "../scripts/opi-destinos-shorts";

const CTX = { userId: "u1", workspaceId: "w1", role: "OWNER" };
const futuro = new Date(Date.now() + 7 * 86_400_000);
const TEXTO = `Texto próprio.\n\n${AVISO_OBRIGATORIO}`;
const params = { params: Promise.resolve({ id: "p1" }) };

function req(url: string, body?: unknown, method = "POST") {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const linha = (rede: string, extra: Record<string, unknown> = {}) => ({
  id: `d-${rede}`,
  rede,
  status: "PENDENTE",
  externoId: null,
  permalink: null,
  erro: null,
  tentativas: 0,
  publicadoEm: null,
  titulo: null,
  descricao: null,
  aprovadoEm: null,
  ...extra,
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  auth.getCurrentWorkspaceId.mockResolvedValue("w1");
  access.getCurrentWorkspaceContext.mockResolvedValue(CTX);
  mockPrisma.postDestino.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.postDestino.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.user.findUnique.mockResolvedValue({ email: "luan@exemplo.com" });
});

describe("GET /api/opi/posts: cada post leva os destinos", () => {
  it("devolve os destinos na ordem fixa das redes, com status, link e datas em ISO", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([
      {
        id: "p1",
        status: "PUBLICADO",
        destinos: [
          linha("youtube", { erro: "Composio não configurado", titulo: "Short" }),
          linha("instagram", {
            status: "PUBLICADO",
            externoId: "m1",
            permalink: "https://instagram.com/reel/1",
            publicadoEm: new Date("2026-11-13T21:00:10Z"),
            tentativas: 1,
          }),
        ],
      },
    ]);
    const res = await LISTAR(req("/api/opi/posts?mes=2026-11", undefined, "GET"));
    expect(res.status).toBe(200);
    const { posts } = await res.json();
    expect(posts[0].destinos.map((d: { rede: string }) => d.rede)).toEqual(["instagram", "youtube"]);
    expect(posts[0].destinos[0]).toEqual({
      id: "d-instagram",
      rede: "instagram",
      nome: "Instagram",
      status: "PUBLICADO",
      externoId: "m1",
      permalink: "https://instagram.com/reel/1",
      erro: null,
      tentativas: 1,
      publicadoEm: "2026-11-13T21:00:10.000Z",
      titulo: null,
      descricao: null,
      aprovadoEm: null,
    });
    expect(posts[0].destinos[1]).toMatchObject({ nome: "YouTube", status: "PENDENTE", erro: "Composio não configurado" });
    const arg = mockPrisma.postAgendado.findMany.mock.calls[0][0];
    expect(arg.orderBy).toEqual([{ agendadoPara: "asc" }, { id: "asc" }]);
    expect(arg.include.destinos.select.status).toBe(true);
  });
});

describe("aprovar-mes cria os destinos", () => {
  const rascunhos = [
    { id: "a", tipo: "REEL", legenda: `A. ${AVISO_OBRIGATORIO}`, agendadoPara: futuro },
    { id: "b", tipo: "CARROSSEL", legenda: `B. ${AVISO_OBRIGATORIO}`, agendadoPara: futuro },
  ];

  it("padrão: só Instagram", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue(rascunhos);
    mockPrisma.postAgendado.updateMany.mockResolvedValue({ count: 2 });
    const res = await APROVAR(req("/api/opi/posts/aprovar-mes", { mes: "2026-11" }));
    expect(res.status).toBe(200);
    expect(mockPrisma.postDestino.createMany).toHaveBeenCalledWith({
      data: [
        { postId: "a", rede: "instagram" },
        { postId: "b", rede: "instagram" },
      ],
      skipDuplicates: true,
    });
  });

  it("OPI_DESTINOS_PADRAO vale para o Reel; carrossel segue só no Instagram; linkedin e x nunca entram", async () => {
    vi.stubEnv("OPI_DESTINOS_PADRAO", "instagram,facebook,youtube,linkedin,x");
    mockPrisma.postAgendado.findMany.mockResolvedValue(rascunhos);
    mockPrisma.postAgendado.updateMany.mockResolvedValue({ count: 2 });
    await APROVAR(req("/api/opi/posts/aprovar-mes", { mes: "2026-11" }));
    expect(mockPrisma.postDestino.createMany.mock.calls[0][0].data).toEqual([
      { postId: "a", rede: "instagram" },
      { postId: "a", rede: "facebook" },
      { postId: "a", rede: "youtube" },
      { postId: "b", rede: "instagram" },
    ]);
  });

  it("reaprovar devolve para a fila só o que falhou ou foi pulado; PUBLICADO fica como está", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue(rascunhos);
    mockPrisma.postAgendado.updateMany.mockResolvedValue({ count: 2 });
    await APROVAR(req("/api/opi/posts/aprovar-mes", { mes: "2026-11" }));
    expect(mockPrisma.postDestino.updateMany).toHaveBeenCalledWith({
      where: { postId: { in: ["a", "b"] }, status: { in: ["ERRO", "PULADO"] } },
      data: { status: "PENDENTE", erro: null, tentativas: 0 },
    });
    // Os destinos existem antes de o post virar APROVADO.
    expect(mockPrisma.postDestino.createMany.mock.invocationCallOrder[0]).toBeLessThan(
      mockPrisma.postAgendado.updateMany.mock.invocationCallOrder[0],
    );
  });

  it("calendário recusado (sem aviso) não cria destino nenhum", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([{ id: "a", tipo: "REEL", legenda: "Sem aviso", agendadoPara: futuro }]);
    const res = await APROVAR(req("/api/opi/posts/aprovar-mes", { mes: "2026-11" }));
    expect(res.status).toBe(422);
    expect(mockPrisma.postDestino.createMany).not.toHaveBeenCalled();
  });
});

describe("POST /api/opi/posts/[id]/destinos", () => {
  beforeEach(() => {
    mockPrisma.postAgendado.findFirst.mockResolvedValue({ id: "p1" });
  });

  it("cria o destino linkedin sem aprovação; aprovar grava quem e quando", async () => {
    mockPrisma.postDestino.findUnique.mockResolvedValueOnce(null).mockResolvedValueOnce(linha("linkedin", { descricao: TEXTO }));
    const res = await DESTINO(req("/api/opi/posts/p1/destinos", { rede: "linkedin", descricao: TEXTO }), params);
    expect(res.status).toBe(201);
    expect(mockPrisma.postDestino.createMany).toHaveBeenCalledWith({
      data: [{ postId: "p1", rede: "linkedin", descricao: TEXTO, aprovadoEm: null, aprovadoPor: null }],
      skipDuplicates: true,
    });

    mockPrisma.postDestino.findUnique.mockResolvedValueOnce({ id: "d-linkedin", status: "PENDENTE" }).mockResolvedValueOnce(linha("linkedin"));
    const aprovado = await DESTINO(req("/api/opi/posts/p1/destinos", { rede: "linkedin", aprovar: true }), params);
    expect(aprovado.status).toBe(200);
    const arg = mockPrisma.postDestino.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "d-linkedin", status: { notIn: ["PUBLICANDO", "PUBLICADO"] } });
    expect(arg.data.aprovadoEm).toBeInstanceOf(Date);
    expect(arg.data.aprovadoPor).toBe("luan@exemplo.com");
  });

  it("mudar o texto do linkedin aprovado derruba a aprovação", async () => {
    mockPrisma.postDestino.findUnique.mockResolvedValueOnce({ id: "d-linkedin", status: "PENDENTE" }).mockResolvedValueOnce(linha("linkedin"));
    await DESTINO(req("/api/opi/posts/p1/destinos", { rede: "linkedin", descricao: `Outro. ${AVISO_OBRIGATORIO}` }), params);
    expect(mockPrisma.postDestino.updateMany.mock.calls[0][0].data).toMatchObject({ aprovadoEm: null, aprovadoPor: null });
  });

  it("título do youtube não mexe em aprovação; tentarDeNovo devolve o que falhou para a fila", async () => {
    mockPrisma.postDestino.findUnique.mockResolvedValueOnce({ id: "d-youtube", status: "ERRO" }).mockResolvedValueOnce(linha("youtube"));
    await DESTINO(req("/api/opi/posts/p1/destinos", { rede: "youtube", titulo: "Short novo", tentarDeNovo: true }), params);
    expect(mockPrisma.postDestino.updateMany.mock.calls[0][0].data).toEqual({ titulo: "Short novo", status: "PENDENTE", erro: null, tentativas: 0 });
  });

  it("destino publicado ou em publicação não muda (409)", async () => {
    for (const status of ["PUBLICADO", "PUBLICANDO"]) {
      mockPrisma.postDestino.findUnique.mockResolvedValueOnce({ id: "d-instagram", status });
      const res = await DESTINO(req("/api/opi/posts/p1/destinos", { rede: "instagram", tentarDeNovo: true }), params);
      expect(res.status).toBe(409);
    }
    expect(mockPrisma.postDestino.updateMany).not.toHaveBeenCalled();
  });

  it("recusa descrição sem o aviso (422), rede desconhecida e campo a mais (400), outro workspace (404)", async () => {
    expect((await DESTINO(req("/api/opi/posts/p1/destinos", { rede: "youtube", descricao: "Sem aviso" }), params)).status).toBe(422);
    expect((await DESTINO(req("/api/opi/posts/p1/destinos", { rede: "orkut" }), params)).status).toBe(400);
    expect((await DESTINO(req("/api/opi/posts/p1/destinos", { rede: "x", status: "PUBLICADO" }), params)).status).toBe(400);
    mockPrisma.postAgendado.findFirst.mockResolvedValue(null);
    expect((await DESTINO(req("/api/opi/posts/p1/destinos", { rede: "x" }), params)).status).toBe(404);
    expect(mockPrisma.postAgendado.findFirst.mock.calls[0][0].where).toEqual({ id: "p1", workspaceId: "w1" });
    expect(mockPrisma.postDestino.createMany).not.toHaveBeenCalled();
  });

  it("sem sessão 401; membro comum 403; GET lista os destinos do post do workspace", async () => {
    access.getCurrentWorkspaceContext.mockResolvedValueOnce(null);
    expect((await DESTINO(req("/api/opi/posts/p1/destinos", { rede: "x" }), params)).status).toBe(401);
    access.getCurrentWorkspaceContext.mockResolvedValueOnce({ ...CTX, role: "MEMBER" });
    expect((await DESTINO(req("/api/opi/posts/p1/destinos", { rede: "x" }), params)).status).toBe(403);

    mockPrisma.postAgendado.findFirst.mockResolvedValue({ id: "p1", destinos: [linha("facebook"), linha("instagram")] });
    const res = await DESTINOS(req("/api/opi/posts/p1/destinos", undefined, "GET"), params);
    expect((await res.json()).destinos.map((d: { rede: string }) => d.rede)).toEqual(["instagram", "facebook"]);
  });
});

describe("Redes: data do último post publicado", () => {
  it("montarRedes preenche ultimoPostEm por rede e deixa null onde nunca saiu", () => {
    const redes = montarRedes([], null, { instagram: "2026-11-13T21:00:10.000Z", youtube: "2026-11-12T21:00:00.000Z" });
    const por = Object.fromEntries(redes.map((r) => [r.id, r.ultimoPostEm]));
    expect(por.instagram).toBe("2026-11-13T21:00:10.000Z");
    expect(por.youtube).toBe("2026-11-12T21:00:00.000Z");
    expect(por.facebook).toBeNull();
    expect(montarRedes([]).every((r) => r.ultimoPostEm === null)).toBe(true);
  });

  it("GET /api/opi/redes lê só destinos PUBLICADO do workspace da sessão", async () => {
    mockPrisma.redeSnapshot.findMany.mockResolvedValue([]);
    mockPrisma.followerSnapshot.findFirst.mockResolvedValue(null);
    mockPrisma.postDestino.groupBy.mockResolvedValue([
      { rede: "facebook", _max: { publicadoEm: new Date("2026-11-14T21:00:05Z") } },
      { rede: "instagram", _max: { publicadoEm: null } },
    ]);
    const res = await REDES();
    expect(res.status).toBe(200);
    expect(mockPrisma.postDestino.groupBy).toHaveBeenCalledWith({
      by: ["rede"],
      where: { status: "PUBLICADO", publicadoEm: { not: null }, post: { workspaceId: "w1" } },
      _max: { publicadoEm: true },
    });
    const { data } = await res.json();
    const por = Object.fromEntries(data.map((r: { id: string; ultimoPostEm: string | null }) => [r.id, r.ultimoPostEm]));
    expect(por.facebook).toBe("2026-11-14T21:00:05.000Z");
    expect(por.instagram).toBeNull();
  });
});

describe("script do plano de Shorts (decidir)", () => {
  const AGORA = new Date("2026-11-14T12:00:00Z");
  const item = {
    id: "plano-1",
    video: "https://cdn.exemplo/v15.mp4",
    publishAt: "2026-11-15T21:00:00.000Z",
    titulo: "O que acontece com a opção no vencimento?",
    descricao: `Opções têm data de vencimento.\n\n${AVISO_OBRIGATORIO}`,
    bloqueado: false,
  };
  const post = (extra: Partial<PostDoPlano> = {}): PostDoPlano => ({
    id: "p15",
    agendadoPara: new Date("2026-11-15T21:00:00Z"),
    midias: ["https://cdn.exemplo/v15.mp4"],
    destinos: [],
    ...extra,
  });
  const yt = (extra: Record<string, unknown> = {}) => ({ id: "d-yt", rede: "youtube", status: "PENDENTE", erro: null, titulo: null, descricao: null, ...extra });

  it("pula o bloqueado, o sem título, o título longo e a descrição sem o aviso", () => {
    expect(decidir({ ...item, bloqueado: true }, [post()], { agora: AGORA })).toEqual({ acao: "pular", motivo: "bloqueado no plano" });
    expect(decidir({ ...item, titulo: " " }, [post()], { agora: AGORA })).toMatchObject({ acao: "pular", motivo: "sem título" });
    expect(decidir({ ...item, titulo: "x".repeat(101) }, [post()], { agora: AGORA })).toMatchObject({ acao: "pular" });
    expect(decidir({ ...item, descricao: "Sem aviso" }, [post()], { agora: AGORA })).toMatchObject({ motivo: "descrição sem o aviso obrigatório" });
  });

  it("casa pelo Reel aprovado do mesmo dia (São Paulo) e cria o destino youtube", () => {
    const outroDia = post({ id: "p16", agendadoPara: new Date("2026-11-16T21:00:00Z") });
    expect(decidir(item, [outroDia, post()], { agora: AGORA })).toEqual({ acao: "criar", postId: "p15", liberar: false });
    // 15/11 23h30 em São Paulo ainda é dia 15, embora já seja 16 em UTC.
    const tarde = post({ id: "p15b", agendadoPara: new Date("2026-11-16T02:30:00Z") });
    expect(decidir(item, [tarde], { agora: AGORA })).toMatchObject({ acao: "criar", postId: "p15b" });
    expect(decidir(item, [outroDia], { agora: AGORA })).toMatchObject({ acao: "pular", motivo: "nenhum Reel aprovado em 2026-11-15" });
  });

  it("casa pelo id do item quando ele é o id do post; dois Reels no dia desempatam pelo vídeo", () => {
    const pelaId = post({ id: "plano-1", agendadoPara: new Date("2026-11-20T21:00:00Z") });
    expect(decidir(item, [post(), pelaId], { agora: AGORA })).toMatchObject({ postId: "plano-1" });
    const outro = post({ id: "p15x", midias: ["https://cdn.exemplo/outro.mp4"] });
    expect(decidir({ ...item, id: undefined }, [outro, post()], { agora: AGORA })).toMatchObject({ acao: "criar", postId: "p15" });
    expect(decidir({ ...item, id: undefined, video: undefined }, [outro, post()], { agora: AGORA })).toMatchObject({ acao: "pular" });
  });

  it("post cuja hora já passou é pulado, a não ser com --incluir-passados", () => {
    const passado = post({ agendadoPara: new Date("2026-11-13T21:00:00Z") });
    const antigo = { ...item, publishAt: "2026-11-13T21:00:00.000Z" };
    expect(decidir(antigo, [passado], { agora: AGORA })).toMatchObject({ acao: "pular" });
    expect(decidir(antigo, [passado], { agora: AGORA, incluirPassados: true })).toMatchObject({ acao: "criar" });
  });

  it("destino existente: atualiza, não mexe no publicado e só libera o que parou por falta de título", () => {
    expect(decidir(item, [post({ destinos: [yt()] })], { agora: AGORA })).toEqual({ acao: "atualizar", postId: "p15", destinoId: "d-yt", liberar: false });
    expect(decidir(item, [post({ destinos: [yt({ titulo: item.titulo, descricao: item.descricao })] })], { agora: AGORA })).toMatchObject({ acao: "igual" });
    expect(decidir(item, [post({ destinos: [yt({ status: "PUBLICADO" })] })], { agora: AGORA })).toMatchObject({ acao: "pular" });
    const semTitulo = yt({ status: "ERRO", erro: "YouTube sem título. Preencha o título do Short antes de aprovar de novo." });
    expect(decidir(item, [post({ destinos: [semTitulo] })], { agora: AGORA })).toMatchObject({ acao: "atualizar", liberar: true });
    const outraFalha = yt({ status: "ERRO", erro: "Composio (YOUTUBE_UPLOAD_VIDEO): quota" });
    expect(decidir(item, [post({ destinos: [outraFalha] })], { agora: AGORA })).toMatchObject({ acao: "atualizar", liberar: false });
  });
});
