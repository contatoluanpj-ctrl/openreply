import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    postAgendado: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    workspace: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/meta/facebook-login", () => ({ resolvePageAccessToken: vi.fn(async (t: string) => t) }));

import { publicadorLigado, publicarPost, rodarPublicador, type PublicarDeps } from "@/lib/opi/publicador";
import { AVISO_OBRIGATORIO, temAviso } from "@/lib/opi/aviso";

const TOKEN = "TOKEN-SECRETO-123";
const LEGENDA = `Texto do post.\n\n${AVISO_OBRIGATORIO}`;

type Chamada = { metodo: string; url: string; params: Record<string, string> };

function graphFalso(respostas: Array<Record<string, unknown> | { __status: number; body: unknown }>) {
  const chamadas: Chamada[] = [];
  const fila = [...respostas];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    const metodo = init?.method ?? "GET";
    const params: Record<string, string> =
      metodo === "POST"
        ? Object.fromEntries(new URLSearchParams(String(init?.body)))
        : Object.fromEntries(u.searchParams);
    chamadas.push({ metodo, url: `${u.origin}${u.pathname}`, params });
    const r = fila.shift() ?? {};
    if ("__status" in r) {
      return new Response(JSON.stringify(r.body), { status: r.__status as number });
    }
    return new Response(JSON.stringify(r), { status: 200 });
  });
  return { fn: fn as unknown as typeof fetch, chamadas };
}

function deps(f: typeof fetch): PublicarDeps {
  return { fetch: f, token: TOKEN, igUserId: "IG1", versao: "v25.0", esperar: async () => {} };
}

const BASE = "https://graph.facebook.com/v25.0";

describe("aviso obrigatório", () => {
  it("reconhece o aviso com espaços e maiúsculas diferentes", () => {
    expect(temAviso("oi\n\nCONTEÚDO educativo.   Não é recomendação individual de investimento.")).toBe(true);
    expect(temAviso("Conteúdo educativo.")).toBe(false);
    expect(temAviso(null)).toBe(false);
  });
});

describe("publicarPost", () => {
  it("carrossel: filhos, CAROUSEL, media_publish e permalink", async () => {
    const g = graphFalso([
      { id: "c1" },
      { id: "c2" },
      { id: "car" },
      { id: "m1" },
      { permalink: "https://instagram.com/p/x" },
    ]);
    const r = await publicarPost(
      { id: "p", tipo: "CARROSSEL", midias: ["https://a/1.png", "https://a/2.png"], legenda: LEGENDA },
      deps(g.fn),
    );
    expect(r).toEqual({ mediaId: "m1", permalink: "https://instagram.com/p/x" });
    expect(g.chamadas.map((c) => `${c.metodo} ${c.url}`)).toEqual([
      `POST ${BASE}/IG1/media`,
      `POST ${BASE}/IG1/media`,
      `POST ${BASE}/IG1/media`,
      `POST ${BASE}/IG1/media_publish`,
      `GET ${BASE}/m1`,
    ]);
    expect(g.chamadas[0].params).toMatchObject({ image_url: "https://a/1.png", is_carousel_item: "true" });
    expect(g.chamadas[2].params).toMatchObject({ media_type: "CAROUSEL", children: "c1,c2", caption: LEGENDA });
    expect(g.chamadas[3].params).toMatchObject({ creation_id: "car" });
    expect(g.chamadas[0].params.access_token).toBe(TOKEN);
  });

  it("imagem única: media com image_url e caption, depois media_publish", async () => {
    const g = graphFalso([{ id: "img" }, { id: "m2" }, { permalink: "https://instagram.com/p/y" }]);
    const r = await publicarPost(
      { id: "p", tipo: "POST", midias: ["https://a/1.png"], legenda: LEGENDA },
      deps(g.fn),
    );
    expect(r.mediaId).toBe("m2");
    expect(g.chamadas[0].params).toMatchObject({ image_url: "https://a/1.png", caption: LEGENDA });
    expect(g.chamadas[0].params.media_type).toBeUndefined();
    expect(g.chamadas[1].params).toMatchObject({ creation_id: "img" });
  });

  it("reel: REELS com video_url, espera FINISHED e publica", async () => {
    const g = graphFalso([
      { id: "reel" },
      { status_code: "IN_PROGRESS" },
      { status_code: "FINISHED" },
      { id: "m3" },
      { permalink: "https://instagram.com/reel/z" },
    ]);
    const esperar = vi.fn(async () => {});
    const r = await publicarPost(
      { id: "p", tipo: "REEL", midias: ["https://a/v.mp4"], legenda: LEGENDA },
      { ...deps(g.fn), esperar },
    );
    expect(r).toEqual({ mediaId: "m3", permalink: "https://instagram.com/reel/z" });
    expect(g.chamadas[0].params).toMatchObject({ media_type: "REELS", video_url: "https://a/v.mp4", caption: LEGENDA });
    expect(g.chamadas[1]).toMatchObject({ metodo: "GET", url: `${BASE}/reel` });
    expect(g.chamadas[1].params.fields).toBe("status_code");
    expect(esperar).toHaveBeenCalledTimes(1);
    expect(g.chamadas[3].params).toMatchObject({ creation_id: "reel" });
  });

  it("reel com status ERROR não chega ao media_publish", async () => {
    const g = graphFalso([{ id: "reel" }, { status_code: "ERROR" }]);
    await expect(
      publicarPost({ id: "p", tipo: "REEL", midias: ["https://a/v.mp4"], legenda: LEGENDA }, deps(g.fn)),
    ).rejects.toThrow(/ERROR/);
    expect(g.chamadas.some((c) => c.url.endsWith("media_publish"))).toBe(false);
  });

  it("erro da Graph vira mensagem curta sem o token", async () => {
    const g = graphFalso([
      { __status: 400, body: { error: { message: `Invalid token ${TOKEN}`, code: 190 } } },
    ]);
    const erro = await publicarPost(
      { id: "p", tipo: "POST", midias: ["https://a/1.png"], legenda: LEGENDA },
      deps(g.fn),
    ).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(Error);
    expect((erro as Error).message).toContain("código 190");
    expect((erro as Error).message).not.toContain(TOKEN);
  });
});

describe("rodarPublicador", () => {
  const agora = new Date("2026-11-20T21:00:00Z");
  const aprovado = {
    id: "p1",
    workspaceId: "w1",
    tipo: "POST" as const,
    midias: ["https://a/1.png"],
    legenda: LEGENDA,
    agendadoPara: new Date("2026-11-20T20:59:00Z"),
    status: "APROVADO",
    aprovadoEm: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPI_PUBLICADOR = "on";
    mockPrisma.postAgendado.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.postAgendado.update.mockResolvedValue({});
  });
  afterEach(() => {
    delete process.env.OPI_PUBLICADOR;
  });

  it("desligado por padrão: não consulta o banco", async () => {
    delete process.env.OPI_PUBLICADOR;
    const r = await rodarPublicador(agora);
    expect(r.ligado).toBe(false);
    expect(mockPrisma.postAgendado.findMany).not.toHaveBeenCalled();
  });

  it("só busca APROVADO com aprovadoEm e agendadoPara <= agora", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([]);
    await rodarPublicador(agora, { fetch: vi.fn() as unknown as typeof fetch, token: TOKEN, igUserId: "IG1", versao: "v25.0" });
    expect(mockPrisma.postAgendado.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "APROVADO", aprovadoEm: { not: null }, agendadoPara: { lte: agora } },
      }),
    );
  });

  it("publica e grava PUBLICADO com mediaId e permalink", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([aprovado]);
    const g = graphFalso([{ id: "img" }, { id: "m9" }, { permalink: "https://instagram.com/p/9" }]);
    const r = await rodarPublicador(agora, { fetch: g.fn, token: TOKEN, igUserId: "IG1", versao: "v25.0" });
    expect(r.publicados).toBe(1);
    expect(mockPrisma.postAgendado.updateMany).toHaveBeenCalledWith({
      where: { id: "p1", status: "APROVADO" },
      data: { status: "PUBLICANDO", erro: null },
    });
    expect(mockPrisma.postAgendado.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { status: "PUBLICADO", mediaId: "m9", permalink: "https://instagram.com/p/9", erro: null },
    });
  });

  it("trava atômica: count 0 não publica", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([aprovado]);
    mockPrisma.postAgendado.updateMany
      .mockResolvedValueOnce({ count: 0 }) // varredura de PUBLICANDO travado
      .mockResolvedValueOnce({ count: 0 }); // trava do post
    const f = vi.fn();
    const r = await rodarPublicador(agora, { fetch: f as unknown as typeof fetch, token: TOKEN, igUserId: "IG1", versao: "v25.0" });
    expect(r.pulados).toBe(1);
    expect(f).not.toHaveBeenCalled();
    expect(mockPrisma.postAgendado.update).not.toHaveBeenCalled();
  });

  it("item sem aviso vira ERRO sem chamar a Graph", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([{ ...aprovado, legenda: "Sem aviso aqui" }]);
    const f = vi.fn();
    const r = await rodarPublicador(agora, { fetch: f as unknown as typeof fetch, token: TOKEN, igUserId: "IG1", versao: "v25.0" });
    expect(r.erros).toBe(1);
    expect(f).not.toHaveBeenCalled();
    expect(mockPrisma.postAgendado.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "ERRO" }) }),
    );
  });

  it("erro da Graph grava ERRO sem o token", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([aprovado]);
    const g = graphFalso([{ __status: 400, body: { error: { message: `bad access_token=${TOKEN}` } } }]);
    const erroLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await rodarPublicador(agora, { fetch: g.fn, token: TOKEN, igUserId: "IG1", versao: "v25.0" });
    expect(r.erros).toBe(1);
    const gravado = mockPrisma.postAgendado.update.mock.calls[0][0].data;
    expect(gravado.status).toBe("ERRO");
    expect(gravado.erro).not.toContain(TOKEN);
    expect(JSON.stringify(erroLog.mock.calls)).not.toContain(TOKEN);
    erroLog.mockRestore();
  });
});

describe("chave da publicação automática no painel (Workspace.opiPublicadorLigado)", () => {
  const agora = new Date("2026-11-20T21:00:00Z");
  const DEPS = { fetch: vi.fn() as unknown as typeof fetch, token: TOKEN, igUserId: "IG1", versao: "v25.0" };
  const aprovado = {
    id: "p1",
    workspaceId: "w1",
    tipo: "POST" as const,
    midias: ["https://a/1.png"],
    legenda: LEGENDA,
    agendadoPara: new Date("2026-11-20T20:59:00Z"),
    status: "APROVADO",
    aprovadoEm: new Date(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.OPI_PUBLICADOR;
    mockPrisma.postAgendado.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.postAgendado.update.mockResolvedValue({});
  });

  it("publicadorLigado: env on OU chave do workspace", () => {
    expect(publicadorLigado()).toBe(false);
    expect(publicadorLigado(false)).toBe(false);
    expect(publicadorLigado(true)).toBe(true);
    process.env.OPI_PUBLICADOR = "on";
    expect(publicadorLigado(false)).toBe(true);
    delete process.env.OPI_PUBLICADOR;
  });

  it("env desligado e nenhuma chave ligada: não lê post nenhum", async () => {
    mockPrisma.workspace.findMany.mockResolvedValue([]);
    const r = await rodarPublicador(agora, DEPS);
    expect(r.ligado).toBe(false);
    expect(mockPrisma.workspace.findMany).toHaveBeenCalledWith({
      where: { opiPublicadorLigado: true, instagramAccounts: { some: { instagramId: "IG1" } } },
      select: { id: true },
    });
    expect(mockPrisma.postAgendado.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.postAgendado.updateMany).not.toHaveBeenCalled();
  });

  it("chave ligada: só busca APROVADO do workspace liberado e publica", async () => {
    mockPrisma.workspace.findMany.mockResolvedValue([{ id: "w1" }]);
    mockPrisma.postAgendado.findMany.mockResolvedValue([aprovado]);
    const g = graphFalso([{ id: "img" }, { id: "m9" }, { permalink: "https://instagram.com/p/9" }]);
    const r = await rodarPublicador(agora, { ...DEPS, fetch: g.fn });
    expect(r).toMatchObject({ ligado: true, workspaces: ["w1"], publicados: 1 });
    expect(mockPrisma.postAgendado.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          workspaceId: { in: ["w1"] },
          status: "APROVADO",
          aprovadoEm: { not: null },
          agendadoPara: { lte: agora },
        },
      }),
    );
  });

  it("chave ligada não afrouxa a trava do aviso: legenda sem aviso vira ERRO sem chamar a Graph", async () => {
    mockPrisma.workspace.findMany.mockResolvedValue([{ id: "w1" }]);
    mockPrisma.postAgendado.findMany.mockResolvedValue([{ ...aprovado, legenda: "Sem aviso" }]);
    const f = vi.fn();
    const r = await rodarPublicador(agora, { ...DEPS, fetch: f as unknown as typeof fetch });
    expect(r.erros).toBe(1);
    expect(f).not.toHaveBeenCalled();
  });

  it("post de outro workspace que escapar do filtro é pulado, sem trava nem publicação", async () => {
    mockPrisma.workspace.findMany.mockResolvedValue([{ id: "w1" }]);
    mockPrisma.postAgendado.findMany.mockResolvedValue([{ ...aprovado, workspaceId: "w2" }]);
    const f = vi.fn();
    const r = await rodarPublicador(agora, { ...DEPS, fetch: f as unknown as typeof fetch });
    expect(r.pulados).toBe(1);
    expect(f).not.toHaveBeenCalled();
    // Só a varredura de PUBLICANDO travado rodou; a trava APROVADO -> PUBLICANDO não.
    expect(mockPrisma.postAgendado.updateMany).toHaveBeenCalledTimes(1);
  });

  it("sem META_IG_USER_ID não há conta para publicar: nem consulta o banco", async () => {
    const r = await rodarPublicador(agora);
    expect(r.ligado).toBe(false);
    expect(mockPrisma.workspace.findMany).not.toHaveBeenCalled();
  });
});
