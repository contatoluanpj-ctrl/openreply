import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  keys: { findUnique: vi.fn(), update: vi.fn() },
  eval: vi.fn(),
  db: null as unknown,
}));
vi.mock("@/lib/db/client", () => ({
  prisma: new Proxy({}, { get: (_t, nome: string) => (nome === "serviceKey" ? state.keys : (state.db as Record<string, unknown>)[nome]) }),
}));
vi.mock("ioredis", () => ({ default: class { status = "ready"; eval = state.eval; listenerCount() { return 1; } } }));

import { POST as CRIAR } from "../app/api/opi/ingest/post/route";
import { POST as DECIDIR } from "../app/api/opi/ingest/post/[id]/route";
import { AVISO_OBRIGATORIO } from "../lib/opi/aviso";
import { criarRascunhoIngest, decidirIngest, seloDoPost, type DbIngest } from "../lib/opi/ingest";

const AGORA = new Date("2026-11-20T15:00:00Z");
const ENV = { BLOB_STORE_ID: "store_abc123", NEXTAUTH_URL: "https://painel.exemplo", OPI_DESTINOS_PADRAO: "instagram,facebook,youtube" };
const MIDIA = "https://abc123.public.blob.vercel-storage.com/opi/2026-11/ff-N02.mp4";
const LEGENDA = `A Anthropic pediu registro para abrir capital.\n\n${AVISO_OBRIGATORIO}`;
const ENTRADA = { midia: MIDIA, legenda: LEGENDA, tituloYoutube: "Anthropic pede IPO: o que muda", origem: "noticia:N02" };

type Post = { id: string; workspaceId: string; tipo: string; midias: unknown; legenda: string; agendadoPara: Date; status: string; origem: string | null; aprovadoEm: Date | null; aprovadoPor: string | null; updatedAt: Date };
type Destino = { postId: string; rede: string; status: string; titulo: string | null; erro: string | null; tentativas: number };

/** Banco em memória com só o que a entrada pela esteira usa. */
function bancoFalso() {
  const posts: Post[] = [];
  const destinos: Destino[] = [];
  let n = 0;
  const bate = (p: Post, w: Record<string, unknown>) =>
    Object.entries(w).every(([k, v]) => {
      const atual = (p as unknown as Record<string, unknown>)[k];
      return v instanceof Date ? atual instanceof Date && atual.getTime() === v.getTime() : atual === v;
    });
  const db = {
    postAgendado: {
      create: vi.fn(async ({ data }: { data: Omit<Post, "id" | "aprovadoEm" | "aprovadoPor" | "updatedAt"> }) => {
        const p: Post = { ...data, id: `post${++n}`, aprovadoEm: null, aprovadoPor: null, updatedAt: new Date(AGORA.getTime() + n) };
        posts.push(p);
        return { id: p.id };
      }),
      findFirst: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const p = posts.find((x) => bate(x, where));
        return p ? { ...p, destinos: destinos.filter((d) => d.postId === p.id).map((d) => ({ rede: d.rede, titulo: d.titulo })) } : null;
      }),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Partial<Post> }) => {
        const alvos = posts.filter((x) => bate(x, where));
        for (const p of alvos) Object.assign(p, data, { updatedAt: new Date(p.updatedAt.getTime() + 1000) });
        return { count: alvos.length };
      }),
      deleteMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const alvos = posts.filter((x) => bate(x, where));
        for (const p of alvos) posts.splice(posts.indexOf(p), 1);
        return { count: alvos.length };
      }),
    },
    postDestino: {
      createMany: vi.fn(async ({ data }: { data: Array<{ postId: string; rede: string }> }) => {
        for (const d of data) {
          if (!destinos.some((x) => x.postId === d.postId && x.rede === d.rede)) destinos.push({ ...d, status: "PENDENTE", titulo: null, erro: null, tentativas: 0 });
        }
        return { count: data.length };
      }),
      updateMany: vi.fn(async ({ where, data }: { where: { postId?: string | { in: string[] }; rede?: string; status?: { in: string[] } }; data: Partial<Destino> }) => {
        const ids = typeof where.postId === "string" ? [where.postId] : (where.postId?.in ?? []);
        const alvos = destinos.filter((d) => ids.includes(d.postId) && (!where.rede || d.rede === where.rede) && (!where.status || where.status.in.includes(d.status)));
        for (const d of alvos) Object.assign(d, data);
        return { count: alvos.length };
      }),
      findMany: vi.fn(async ({ where }: { where: { postId: string } }) =>
        destinos.filter((d) => d.postId === where.postId).map((d) => ({ rede: d.rede })).sort((a, b) => a.rede.localeCompare(b.rede))),
    },
  };
  return { db: db as unknown as DbIngest, bruto: db, posts, destinos };
}

const deps = { env: ENV, agora: () => AGORA };

describe("selo da prévia", () => {
  const base = { tipo: "REEL", midias: [MIDIA], legenda: LEGENDA, agendadoPara: AGORA, tituloYoutube: "T", origem: "noticia:N02" };
  it("é estável e muda com qualquer campo", () => {
    const selo = seloDoPost(base);
    expect(selo).toMatch(/^[0-9a-f]{64}$/);
    expect(seloDoPost({ ...base, agendadoPara: AGORA.toISOString() })).toBe(selo);
    for (const outro of [
      { ...base, legenda: `${LEGENDA} ` },
      { ...base, midias: ["https://abc123.public.blob.vercel-storage.com/opi/2026-11/ff-OUTRO.mp4"] },
      { ...base, agendadoPara: new Date(AGORA.getTime() + 60_000) },
      { ...base, tituloYoutube: "Outro" },
      { ...base, origem: "noticia:N03" },
      { ...base, tipo: "POST" },
    ]) {
      expect(seloDoPost(outro)).not.toBe(selo);
    }
  });
});

describe("criarRascunhoIngest", () => {
  it("cria RASCUNHO de Reel com origem, os destinos padrão e o título do YouTube; nada aprovado", async () => {
    const b = bancoFalso();
    const r = await criarRascunhoIngest(b.db, "w1", ENTRADA, deps);
    expect(b.posts).toHaveLength(1);
    expect(b.posts[0]).toMatchObject({ workspaceId: "w1", tipo: "REEL", midias: [MIDIA], legenda: LEGENDA, status: "RASCUNHO", origem: "noticia:N02", aprovadoEm: null });
    expect(b.posts[0].agendadoPara).toEqual(AGORA);
    expect(r.destinos).toEqual(["facebook", "instagram", "youtube"]);
    expect(b.destinos.find((d) => d.rede === "youtube")?.titulo).toBe(ENTRADA.tituloYoutube);
    expect(b.destinos.some((d) => ["linkedin", "threads", "x"].includes(d.rede))).toBe(false);
    expect(r.selo).toBe(seloDoPost({ tipo: "REEL", midias: [MIDIA], legenda: LEGENDA, agendadoPara: AGORA, tituloYoutube: ENTRADA.tituloYoutube, origem: "noticia:N02" }));
  });

  it("recusa mídia de fora, mídia que não é mp4, legenda sem aviso e data passada; nada é gravado", async () => {
    const b = bancoFalso();
    for (const ruim of [
      { ...ENTRADA, midia: "https://cdn.qualquer.com/v.mp4" },
      { ...ENTRADA, midia: "https://outra.public.blob.vercel-storage.com/opi/v.mp4" },
      { ...ENTRADA, midia: "https://abc123.public.blob.vercel-storage.com/opi/2026-11/ff-capa.png" },
      { ...ENTRADA, legenda: "Sem o aviso." },
      { ...ENTRADA, agendadoPara: "2026-11-20T14:59:00Z" },
    ]) {
      await expect(criarRascunhoIngest(b.db, "w1", ruim, deps)).rejects.toMatchObject({ status: 400 });
    }
    expect(b.posts).toHaveLength(0);
    expect(b.bruto.postAgendado.create).not.toHaveBeenCalled();
  });

  it("com data futura, guarda a data pedida", async () => {
    const b = bancoFalso();
    const r = await criarRascunhoIngest(b.db, "w1", { ...ENTRADA, agendadoPara: "2026-11-23T21:00:00Z" }, deps);
    expect(r.agendadoPara).toBe("2026-11-23T21:00:00.000Z");
  });
});

describe("decidirIngest", () => {
  async function comRascunho(entrada = ENTRADA) {
    const b = bancoFalso();
    const r = await criarRascunhoIngest(b.db, "w1", entrada, deps);
    return { ...b, id: r.id, selo: r.selo };
  }
  const DEPOIS = new Date("2026-11-20T15:10:00Z");
  const depois = { env: ENV, agora: () => DEPOIS };

  it("aprova com o selo da prévia: grava quem aprovou e libera para agora", async () => {
    const b = await comRascunho();
    const r = await decidirIngest(b.db, "w1", b.id, { acao: "aprovar", selo: b.selo, aprovadoPor: "telegram:msg-812" }, depois);
    expect(r).toEqual({ id: b.id, status: "APROVADO", agendadoPara: DEPOIS.toISOString() });
    expect(b.posts[0]).toMatchObject({ status: "APROVADO", aprovadoPor: "esteira:telegram:msg-812", aprovadoEm: DEPOIS, agendadoPara: DEPOIS });
  });

  it("data futura não é adiantada na aprovação", async () => {
    const b = await comRascunho({ ...ENTRADA, agendadoPara: "2026-11-23T21:00:00Z" } as typeof ENTRADA);
    const r = await decidirIngest(b.db, "w1", b.id, { acao: "aprovar", selo: b.selo, aprovadoPor: "telegram:msg-1" }, depois);
    expect(r.agendadoPara).toBe("2026-11-23T21:00:00.000Z");
  });

  it("selo errado ou post alterado depois da prévia: 409 e nada muda", async () => {
    const b = await comRascunho();
    await expect(decidirIngest(b.db, "w1", b.id, { acao: "aprovar", selo: "0".repeat(64), aprovadoPor: "telegram:x" }, depois)).rejects.toMatchObject({ status: 409 });
    for (const mudanca of [{ legenda: `Outra legenda.\n\n${AVISO_OBRIGATORIO}` }, { midias: ["https://abc123.public.blob.vercel-storage.com/opi/2026-11/ff-OUTRO.mp4"] }, { agendadoPara: new Date("2026-12-01T21:00:00Z") }]) {
      const c = await comRascunho();
      Object.assign(c.posts[0], mudanca);
      await expect(decidirIngest(c.db, "w1", c.id, { acao: "aprovar", selo: c.selo, aprovadoPor: "telegram:x" }, depois)).rejects.toMatchObject({ status: 409 });
      expect(c.posts[0].status).toBe("RASCUNHO");
    }
    const t = await comRascunho();
    t.destinos.find((d) => d.rede === "youtube")!.titulo = "Título trocado";
    await expect(decidirIngest(t.db, "w1", t.id, { acao: "aprovar", selo: t.selo, aprovadoPor: "telegram:x" }, depois)).rejects.toMatchObject({ status: 409 });
    expect(b.posts[0].status).toBe("RASCUNHO");
  });

  it("post sem origem (criado ou editado no painel) nunca é aprovado nem apagado pela chave", async () => {
    const b = await comRascunho();
    b.posts[0].origem = null;
    const selo = seloDoPost({ ...b.posts[0], tituloYoutube: ENTRADA.tituloYoutube });
    for (const acao of ["aprovar", "descartar"] as const) {
      await expect(decidirIngest(b.db, "w1", b.id, { acao, selo, aprovadoPor: "telegram:x" }, depois)).rejects.toMatchObject({ status: 403 });
    }
    expect(b.posts).toHaveLength(1);
    expect(b.posts[0].status).toBe("RASCUNHO");
  });

  it("post de outro workspace não é achado; post já aprovado não é aprovado de novo", async () => {
    const b = await comRascunho();
    await expect(decidirIngest(b.db, "outro", b.id, { acao: "aprovar", selo: b.selo, aprovadoPor: "telegram:x" }, depois)).rejects.toMatchObject({ status: 404 });
    await decidirIngest(b.db, "w1", b.id, { acao: "aprovar", selo: b.selo, aprovadoPor: "telegram:msg-1" }, depois);
    await expect(decidirIngest(b.db, "w1", b.id, { acao: "aprovar", selo: b.selo, aprovadoPor: "telegram:msg-2" }, depois)).rejects.toMatchObject({ status: 409 });
    expect(b.posts[0].aprovadoPor).toBe("esteira:telegram:msg-1");
  });

  it("aprovar exige aprovadoPor, o aviso na legenda e a mídia ainda no nosso armazenamento", async () => {
    const b = await comRascunho();
    await expect(decidirIngest(b.db, "w1", b.id, { acao: "aprovar", selo: b.selo }, depois)).rejects.toMatchObject({ status: 400 });
    const semAviso = await comRascunho();
    semAviso.posts[0].legenda = "Legenda trocada sem aviso.";
    const selo = seloDoPost({ ...semAviso.posts[0], tituloYoutube: ENTRADA.tituloYoutube });
    await expect(decidirIngest(semAviso.db, "w1", semAviso.id, { acao: "aprovar", selo, aprovadoPor: "telegram:x" }, depois)).rejects.toMatchObject({ status: 400 });
    expect(semAviso.posts[0].status).toBe("RASCUNHO");
    const outraLoja = await comRascunho();
    await expect(decidirIngest(outraLoja.db, "w1", outraLoja.id, { acao: "aprovar", selo: outraLoja.selo, aprovadoPor: "telegram:x" }, { env: { ...ENV, BLOB_STORE_ID: "store_outra" }, agora: () => DEPOIS })).rejects.toMatchObject({ status: 400 });
  });

  it("edição no meio (updatedAt mudou entre ler e gravar): nada é aprovado", async () => {
    const b = await comRascunho();
    const original = b.bruto.postAgendado.findFirst.getMockImplementation()!;
    b.bruto.postAgendado.findFirst.mockImplementationOnce(async (args: { where: Record<string, unknown> }) => {
      const lido = await original(args);
      b.posts[0].updatedAt = new Date(b.posts[0].updatedAt.getTime() + 5000); // alguém salvou o post logo depois da leitura
      return lido;
    });
    await expect(decidirIngest(b.db, "w1", b.id, { acao: "aprovar", selo: b.selo, aprovadoPor: "telegram:x" }, depois)).rejects.toMatchObject({ status: 409 });
    expect(b.posts[0].status).toBe("RASCUNHO");
  });

  it("descartar com edição no meio: responde 409 e o post continua lá", async () => {
    const b = await comRascunho();
    const original = b.bruto.postAgendado.findFirst.getMockImplementation()!;
    b.bruto.postAgendado.findFirst.mockImplementationOnce(async (args: { where: Record<string, unknown> }) => {
      const lido = await original(args);
      b.posts[0].updatedAt = new Date(b.posts[0].updatedAt.getTime() + 5000);
      return lido;
    });
    await expect(decidirIngest(b.db, "w1", b.id, { acao: "descartar", selo: b.selo }, depois)).rejects.toMatchObject({ status: 409 });
    expect(b.posts).toHaveLength(1);
  });

  it("descartar apaga só o rascunho da esteira, com o selo certo", async () => {
    const b = await comRascunho();
    await expect(decidirIngest(b.db, "w1", b.id, { acao: "descartar", selo: "1".repeat(64) }, depois)).rejects.toMatchObject({ status: 409 });
    expect(b.posts).toHaveLength(1);
    expect(await decidirIngest(b.db, "w1", b.id, { acao: "descartar", selo: b.selo }, depois)).toEqual({ id: b.id, status: "DESCARTADO" });
    expect(b.posts).toHaveLength(0);
  });
});

describe("rotas /api/opi/ingest/post", () => {
  const token = `orp_${"d".repeat(43)}`;
  const key = (scopes: string[]) => ({ id: "key", workspaceId: "w1", scopes, expiresAt: new Date("2099-01-01"), revokedAt: null });
  const req = (url: string, body: unknown, headers: Record<string, string> = { authorization: `Bearer ${token}` }) =>
    new Request(`https://painel.exemplo${url}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  let banco: ReturnType<typeof bancoFalso>;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ now: AGORA, toFake: ["Date"] });
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    state.keys.findUnique.mockResolvedValue(key(["posts:rascunho", "posts:aprovar"]));
    state.keys.update.mockResolvedValue({});
    state.eval.mockResolvedValue(1);
    banco = bancoFalso();
    state.db = banco.bruto;
  });

  it("criar: 401 sem chave, 403 sem posts:rascunho, 400 com campo a mais; nada é gravado", async () => {
    expect((await CRIAR(req("/api/opi/ingest/post", ENTRADA, {}))).status).toBe(401);
    state.keys.findUnique.mockResolvedValue(key(["posts:aprovar", "midia:write"]));
    expect((await CRIAR(req("/api/opi/ingest/post", ENTRADA))).status).toBe(403);
    state.keys.findUnique.mockResolvedValue(key(["posts:rascunho"]));
    expect((await CRIAR(req("/api/opi/ingest/post", { ...ENTRADA, status: "APROVADO" }))).status).toBe(400);
    expect((await CRIAR(req("/api/opi/ingest/post", { ...ENTRADA, origem: "com espaço" }))).status).toBe(400);
    expect(banco.posts).toHaveLength(0);
  });

  it("criar e aprovar de ponta a ponta; aprovar exige o escopo posts:aprovar", async () => {
    const criado = await CRIAR(req("/api/opi/ingest/post", ENTRADA));
    expect(criado.status).toBe(201);
    const { id, selo } = (await criado.json()).data;
    expect(banco.posts[0].status).toBe("RASCUNHO");

    state.keys.findUnique.mockResolvedValue(key(["posts:rascunho"]));
    const semEscopo = await DECIDIR(req(`/api/opi/ingest/post/${id}`, { acao: "aprovar", selo, aprovadoPor: "telegram:msg-9" }), { params: Promise.resolve({ id }) });
    expect(semEscopo.status).toBe(403);
    expect(banco.posts[0].status).toBe("RASCUNHO");

    state.keys.findUnique.mockResolvedValue(key(["posts:aprovar"]));
    const errado = await DECIDIR(req(`/api/opi/ingest/post/${id}`, { acao: "aprovar", selo: "a".repeat(64), aprovadoPor: "telegram:msg-9" }), { params: Promise.resolve({ id }) });
    expect(errado.status).toBe(409);
    const ok = await DECIDIR(req(`/api/opi/ingest/post/${id}`, { acao: "aprovar", selo, aprovadoPor: "telegram:msg-9" }), { params: Promise.resolve({ id }) });
    expect(ok.status).toBe(200);
    expect(banco.posts[0]).toMatchObject({ status: "APROVADO", aprovadoPor: "esteira:telegram:msg-9" });
  });

  it("decidir: corpo inválido é 400", async () => {
    for (const corpo of [{}, { acao: "publicar", selo: "a".repeat(64) }, { acao: "aprovar", selo: "curto" }, { acao: "aprovar", selo: "a".repeat(64), aprovadoPor: "x<script>" }]) {
      const res = await DECIDIR(req("/api/opi/ingest/post/p1", corpo), { params: Promise.resolve({ id: "p1" }) });
      expect(res.status, JSON.stringify(corpo)).toBe(400);
    }
  });
});
