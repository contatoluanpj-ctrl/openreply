import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  keys: { findUnique: vi.fn(), update: vi.fn() },
  redes: { create: vi.fn(), findMany: vi.fn() },
  followers: { findFirst: vi.fn() },
  workspace: vi.fn(),
  eval: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({
  prisma: { serviceKey: state.keys, redeSnapshot: state.redes, followerSnapshot: state.followers },
}));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: state.workspace }));
vi.mock("ioredis", () => ({ default: class { status = "ready"; eval = state.eval; listenerCount() { return 1; } } }));

import { POST } from "../app/api/opi/redes/snapshot/route";
import { GET } from "../app/api/opi/redes/route";
import { montarRedes, REDE_IDS } from "../lib/opi/redes";

const token = `orp_${"b".repeat(43)}`;
const key = (scopes: string[]) => ({ id: "key", workspaceId: "ws-da-chave", scopes, expiresAt: new Date("2099-01-01"), revokedAt: null });
const post = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${token}` }) =>
  POST(new Request("https://example.test/api/opi/redes/snapshot", {
    method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body),
  }));
const valido = { rede: "tiktok", estado: "conectado", metricas: { seguidores: 1200, alcance: 5400 } };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  vi.stubEnv("NEXTAUTH_URL", "https://example.test");
  state.keys.findUnique.mockResolvedValue(key(["redes:write"]));
  state.keys.update.mockResolvedValue({});
  state.eval.mockResolvedValue(1);
  state.redes.create.mockImplementation(async ({ data }) => ({ id: "snap", rede: data.rede, estado: data.estado, coletadoEm: new Date() }));
});

describe("POST /api/opi/redes/snapshot", () => {
  it("401 sem Bearer", async () => {
    const res = await post(valido, {});
    expect(res.status).toBe(401);
    expect(state.redes.create).not.toHaveBeenCalled();
  });

  it("401 com chave revogada", async () => {
    state.keys.findUnique.mockResolvedValue({ ...key(["redes:write"]), revokedAt: new Date() });
    expect((await post(valido)).status).toBe(401);
  });

  it("403 com chave sem escopo redes:write", async () => {
    state.keys.findUnique.mockResolvedValue(key(["campaigns:read"]));
    const res = await post(valido);
    expect(res.status).toBe(403);
    expect(state.redes.create).not.toHaveBeenCalled();
  });

  it.each([
    ["rede inválida", { ...valido, rede: "orkut" }],
    ["estado inválido", { ...valido, estado: "ligado" }],
    ["workspaceId no corpo", { ...valido, workspaceId: "outro" }],
    ["métricas demais", { ...valido, metricas: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`m${i}`, i])) }],
    ["métrica com objeto", { ...valido, metricas: { a: { b: 1 } } }],
    ["data inválida", { ...valido, coletadoEm: "ontem" }],
  ])("400 com %s", async (_nome, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(state.redes.create).not.toHaveBeenCalled();
  });

  it("201 grava com o workspace da chave", async () => {
    const res = await post({ ...valido, coletadoEm: "2026-11-07T21:00:00.000Z" });
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const { data } = state.redes.create.mock.calls[0][0];
    expect(data.workspaceId).toBe("ws-da-chave");
    expect(data.rede).toBe("tiktok");
    expect(data.metricas).toEqual(valido.metricas);
    expect(data.coletadoEm).toEqual(new Date("2026-11-07T21:00:00.000Z"));
  });
});

describe("GET /api/opi/redes", () => {
  it("401 sem sessão", async () => {
    state.workspace.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect(state.redes.findMany).not.toHaveBeenCalled();
  });

  it("filtra pelo workspace da sessão e devolve as 9 redes", async () => {
    state.workspace.mockResolvedValue("ws-sessao");
    state.redes.findMany.mockResolvedValue([]);
    state.followers.findFirst.mockResolvedValue({ followersCount: 321, date: new Date("2026-11-07") });
    const res = await GET();
    expect(res.status).toBe(200);
    expect(state.redes.findMany.mock.calls[0][0].where).toEqual({ workspaceId: "ws-sessao" });
    expect(state.followers.findFirst.mock.calls[0][0].where).toEqual({ instagramAccount: { workspaceId: "ws-sessao" } });
    const { data } = await res.json();
    expect(data.map((r: { id: string }) => r.id)).toEqual([...REDE_IDS]);
    expect(data[0]).toMatchObject({ id: "instagram", estado: "conectado", metricas: { seguidores: 321 } });
  });
});

describe("montarRedes", () => {
  it("sem dados: Google Ads sem conta, demais sem dados", () => {
    const redes = montarRedes([]);
    expect(redes).toHaveLength(9);
    expect(redes.find((r) => r.id === "google_ads")?.estado).toBe("sem_conta");
    expect(redes.filter((r) => r.id !== "google_ads").every((r) => r.estado === "sem_dados")).toBe(true);
  });

  it("usa o snapshot mais recente de cada rede", () => {
    const redes = montarRedes([
      { rede: "x", estado: "sem_dados", metricas: {}, coletadoEm: new Date("2026-11-01") },
      { rede: "x", estado: "conectado", metricas: { seguidores: 10 }, coletadoEm: new Date("2026-11-05") },
    ]);
    expect(redes.find((r) => r.id === "x")).toMatchObject({ estado: "conectado", metricas: { seguidores: 10 } });
  });

  it("Instagram usa os seguidores reais do FollowerSnapshot", () => {
    const redes = montarRedes(
      [{ rede: "instagram", estado: "sem_dados", metricas: { seguidores: 1, alcance: 50 }, coletadoEm: new Date("2026-11-01") }],
      { followersCount: 999, date: new Date("2026-11-06") },
    );
    expect(redes[0]).toMatchObject({ estado: "conectado", metricas: { seguidores: 999, alcance: 50 }, coletadoEm: "2026-11-06T00:00:00.000Z" });
  });

  it("ignora redes desconhecidas e estados inválidos vindos do banco", () => {
    const redes = montarRedes([
      { rede: "orkut", estado: "conectado", metricas: {}, coletadoEm: new Date() },
      { rede: "threads", estado: "quebrado", metricas: { a: 1 }, coletadoEm: new Date() },
    ]);
    expect(redes).toHaveLength(9);
    expect(redes.find((r) => r.id === "threads")?.estado).toBe("sem_dados");
  });
});
