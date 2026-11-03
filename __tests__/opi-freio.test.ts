import { describe, it, expect, vi, beforeEach } from "vitest";
import { OperationalEventLevel, OperationalEventSource } from "../app/generated/prisma/enums";
import { EVENTO_PAUSAR, EVENTO_RETOMAR, autorizadoFreio, executarFreio, type DbFreio } from "../lib/opi/freio";

// Banco em memória: campanhas (id → isActive, updatedAt) e eventos opi.freio.*. Valida level/source contra os
// enums gerados do Prisma, para um valor inválido (ex.: "WARN") falhar aqui e não só em produção.
type Camp = { isActive: boolean; updatedAt: Date };
function banco(inicial: Record<string, boolean>) {
  let relogio = 1_000;
  const tick = () => new Date(++relogio);
  const campanhas: Record<string, Camp> = Object.fromEntries(
    Object.entries(inicial).map(([id, isActive]) => [id, { isActive, updatedAt: tick() }]));
  const eventos: { message: string; payload: unknown }[] = [];
  const filtra = (where: Record<string, unknown>) => {
    const lista = typeof where.id === "string" ? [where.id] : (where.id as { in?: string[] } | undefined)?.in;
    const upd = where.updatedAt as { lte?: Date; gt?: Date } | undefined;
    return Object.keys(campanhas).filter((id) => {
      const c = campanhas[id];
      if (lista && !lista.includes(id)) return false;
      if (where.isActive !== undefined && c.isActive !== where.isActive) return false;
      if (upd?.lte && !(c.updatedAt <= upd.lte)) return false;
      if (upd?.gt && !(c.updatedAt > upd.gt)) return false;
      return true;
    });
  };
  const fake = {
    $executeRaw: vi.fn(async () => 1),
    automation: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtra(where).map((id) => ({ id }))),
      updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: { isActive: boolean } }) => {
        const alvo = filtra(where);
        for (const id of alvo) campanhas[id] = { isActive: data.isActive, updatedAt: tick() };
        return { count: alvo.length };
      }),
      count: vi.fn(async ({ where }: { where: Record<string, unknown> }) => filtra(where).length),
    },
    operationalEvent: {
      findFirst: vi.fn(async () => eventos.at(-1) ?? null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        expect(Object.values(OperationalEventLevel)).toContain(data.level);
        expect(Object.values(OperationalEventSource)).toContain(data.source);
        eventos.push({ message: data.message as string, payload: data.payload });
        return {};
      }),
    },
  };
  const painel = (id: string, isActive: boolean) => { campanhas[id] = { isActive, updatedAt: tick() }; };
  const agora = () => tick();
  const ativos = () => Object.fromEntries(Object.entries(campanhas).map(([id, c]) => [id, c.isActive]));
  return { db: fake as unknown as DbFreio, fake, eventos, painel, agora, ativos };
}

describe("freio da DM", () => {
  let b: ReturnType<typeof banco>;
  beforeEach(() => {
    // c3 já estava desligada (por exemplo, pausa da 1ª DM): nunca é religada pelo freio.
    b = banco({ c1: true, c2: true, c3: false });
  });

  it("pausar desliga todas as ativas e guarda quais foram (level WARNING válido)", async () => {
    const r = await executarFreio(b.db, "pausar", null, b.agora);
    expect(r).toMatchObject({ pausado: true, alteradas: 2, guardadas: 2 });
    expect(b.ativos()).toEqual({ c1: false, c2: false, c3: false });
    expect(b.eventos.at(-1)).toMatchObject({ message: EVENTO_PAUSAR, payload: { ids: ["c1", "c2"] } });
  });

  it("retomar religa só as que o freio desligou", async () => {
    await executarFreio(b.db, "pausar", null, b.agora);
    const r = await executarFreio(b.db, "retomar", null, b.agora);
    expect(r).toMatchObject({ pausado: false, alteradas: 2, ativas: 2, mexidasNoPainel: 0 });
    expect(b.ativos()).toEqual({ c1: true, c2: true, c3: false });
    expect(b.eventos.at(-1)?.message).toBe(EVENTO_RETOMAR);
  });

  it("campanha mexida no painel durante a pausa não é religada", async () => {
    await executarFreio(b.db, "pausar", null, b.agora);
    b.painel("c2", false); // Luan editou/desligou de propósito
    const r = await executarFreio(b.db, "retomar", null, b.agora);
    expect(r).toMatchObject({ alteradas: 1, mexidasNoPainel: 1 });
    expect(b.ativos()).toEqual({ c1: true, c2: false, c3: false });
  });

  it("pausar duas vezes não perde a lista da primeira", async () => {
    await executarFreio(b.db, "pausar", null, b.agora);
    b.painel("c4", true); // ativada durante a pausa
    const r = await executarFreio(b.db, "pausar", null, b.agora);
    expect(r.guardadas).toBe(3);
    await executarFreio(b.db, "retomar", null, b.agora);
    expect(b.ativos()).toEqual({ c1: true, c2: true, c3: false, c4: true });
  });

  it("retomar sem pausa anterior não liga nada", async () => {
    const r = await executarFreio(b.db, "retomar", null, b.agora);
    expect(r.alteradas).toBe(0);
    expect(b.ativos().c3).toBe(false);
    expect(b.eventos).toHaveLength(0);
  });

  it("status informa sem alterar", async () => {
    await executarFreio(b.db, "pausar", null, b.agora);
    const r = await executarFreio(b.db, "status", null, b.agora);
    expect(r).toMatchObject({ acao: "status", pausado: true, ativas: 0, guardadas: 2, alteradas: 0 });
  });

  it("pega a trava e só guarda o que ele mesmo desligou (corrida com a pausa da 1ª DM)", async () => {
    // Entre o findMany do freio e o update, o worker pausa c2 na 1ª DM.
    const orig = b.fake.automation.findMany.getMockImplementation()!;
    b.fake.automation.findMany.mockImplementationOnce(async (a) => {
      const r = await orig(a);
      b.painel("c2", false);
      return r;
    });
    const r = await executarFreio(b.db, "pausar", null, b.agora);
    expect(b.fake.$executeRaw).toHaveBeenCalledTimes(1);
    expect(r).toMatchObject({ alteradas: 1, guardadas: 1 });
    expect(b.eventos.at(-1)?.payload).toMatchObject({ ids: ["c1"] });
    await executarFreio(b.db, "retomar", null, b.agora);
    expect(b.ativos()).toEqual({ c1: true, c2: false, c3: false });
  });

  it("filtra pelo workspace quando configurado", async () => {
    await executarFreio(b.db, "pausar", "ws_1", b.agora);
    expect(b.fake.automation.findMany.mock.calls[0][0].where).toMatchObject({ workspaceId: "ws_1" });
  });
});

describe("autorização do freio", () => {
  const segredo = "s".repeat(40);
  it("sem segredo (ou curto) a rota fica fechada", () => {
    expect(autorizadoFreio(`Bearer ${segredo}`, undefined)).toBe("sem_segredo");
    expect(autorizadoFreio("Bearer curto", "curto")).toBe("sem_segredo");
  });
  it("aceita só o Bearer exato", () => {
    expect(autorizadoFreio(`Bearer ${segredo}`, segredo)).toBe("ok");
    expect(autorizadoFreio(`Bearer ${segredo}x`, segredo)).toBe("negado");
    expect(autorizadoFreio(null, segredo)).toBe("negado");
    expect(autorizadoFreio(segredo, segredo)).toBe("negado");
  });
});

// Rota: autorização, corpo e transação (o freio roda dentro de prisma.$transaction).
const { tx, transaction } = vi.hoisted(() => {
  const tx = {
    $executeRaw: vi.fn(async () => 1),
    automation: { findMany: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    operationalEvent: { findFirst: vi.fn(), create: vi.fn() },
  };
  return { tx, transaction: vi.fn() };
});
vi.mock("@/lib/db/client", () => ({ prisma: { $transaction: transaction } }));

describe("rota /api/opi/dm", () => {
  const segredo = "x".repeat(40);
  const req = (body: unknown, auth = `Bearer ${segredo}`) => new Request("https://or.test/api/opi/dm", {
    method: "POST", headers: { authorization: auth, "content-type": "application/json" }, body: JSON.stringify(body),
  });
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPI_FREIO_SECRET = segredo;
    delete process.env.OPI_FREIO_WORKSPACE_ID;
    transaction.mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx));
    tx.operationalEvent.findFirst.mockResolvedValue(null);
    tx.automation.findMany.mockResolvedValue([{ id: "c1" }]);
    tx.automation.updateMany.mockResolvedValue({ count: 1 });
    tx.operationalEvent.create.mockResolvedValue({});
  });

  it("pausar: 200 e roda na transação", async () => {
    const { POST } = await import("../app/api/opi/dm/route");
    const res = await POST(req({ acao: "pausar" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ acao: "pausar", alteradas: 1 });
    expect(transaction).toHaveBeenCalledTimes(1);
  });

  it("sem segredo: 503; segredo errado: 401; corpo inválido: 400", async () => {
    const { POST } = await import("../app/api/opi/dm/route");
    expect((await POST(req({ acao: "pausar" }, "Bearer errado-errado-errado-errado-errado"))).status).toBe(401);
    expect((await POST(req({ acao: "apagar" }))).status).toBe(400);
    delete process.env.OPI_FREIO_SECRET;
    expect((await POST(req({ acao: "pausar" }))).status).toBe(503);
    expect(transaction).not.toHaveBeenCalled();
  });

  it("falha no banco: 500 (o bot então diz que NÃO pausou)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    transaction.mockRejectedValue(new Error("db fora"));
    const { POST } = await import("../app/api/opi/dm/route");
    expect((await POST(req({ acao: "pausar" }))).status).toBe(500);
  });
});
