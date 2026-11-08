import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  keys: { findUnique: vi.fn(), update: vi.fn() },
  pedidos: { findFirst: vi.fn(), updateMany: vi.fn(), findMany: vi.fn(), create: vi.fn() },
  context: vi.fn(), workspaceId: vi.fn(), eval: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: { serviceKey: state.keys, pedidoAgente: state.pedidos } }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: state.context,
  canManageWorkspace: (role: string) => ["OWNER", "ADMIN"].includes(role),
}));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: state.workspaceId }));
vi.mock("ioredis", () => ({ default: class { status = "ready"; eval = state.eval; listenerCount() { return 1; } } }));

import { POST as claim } from "../app/api/agentes/claim/route";
import { POST as responder } from "../app/api/agentes/[id]/resposta/route";
import { GET as listar, POST as enviar } from "../app/api/agentes/route";
import { claimProximoPedido } from "../lib/opi/pedidos";
import { estaAtivo, AGENTES_CHAT } from "../lib/opi/agentes";

const token = `orp_${"b".repeat(43)}`;
const key = { id: "key", workspaceId: "ws", scopes: ["agentes:rw"], expiresAt: new Date("2099-01-01"), revokedAt: null };
const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const req = (url: string, body?: unknown, headers: Record<string, string> = auth) =>
  new Request(`https://example.test${url}`, { method: "POST", headers, body: body === undefined ? undefined : JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const pedido = (id: string) => ({ id, workspaceId: "ws", agente: "editor-de-videos", mensagem: "corta o 03", status: "NOVO", createdAt: new Date() });

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("REDIS_URL", "redis://localhost:6379");
  vi.stubEnv("NEXTAUTH_URL", "https://example.test");
  state.keys.findUnique.mockResolvedValue(key);
  state.keys.update.mockResolvedValue(key);
  state.eval.mockResolvedValue(1);
  state.pedidos.updateMany.mockResolvedValue({ count: 1 });
  state.context.mockResolvedValue({ workspaceId: "ws", role: "OWNER" });
  state.workspaceId.mockResolvedValue("ws");
});

describe("claim de pedidos", () => {
  it("pega o NOVO mais antigo com updateMany condicionado ao status NOVO (atômico)", async () => {
    state.pedidos.findFirst.mockResolvedValueOnce(pedido("p1"));
    const res = await claim(req("/api/agentes/claim"));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data).toMatchObject({ id: "p1", agente: "editor-de-videos", status: "EM_ANDAMENTO" });
    expect(state.pedidos.findFirst).toHaveBeenCalledWith({ where: { workspaceId: "ws", status: "NOVO" }, orderBy: { createdAt: "asc" } });
    const call = state.pedidos.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "p1", workspaceId: "ws", status: "NOVO" });
    expect(call.data.status).toBe("EM_ANDAMENTO");
    expect(call.data.iniciadoEm).toBeInstanceOf(Date);
  });

  it("em corrida (count 0) tenta o próximo pedido", async () => {
    state.pedidos.findFirst.mockResolvedValueOnce(pedido("p1")).mockResolvedValueOnce(pedido("p2"));
    state.pedidos.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    const result = await claimProximoPedido("ws");
    expect(result?.id).toBe("p2");
    expect(state.pedidos.updateMany).toHaveBeenCalledTimes(2);
  });

  it("desiste depois de 3 corridas perdidas", async () => {
    state.pedidos.findFirst.mockResolvedValue(pedido("p1"));
    state.pedidos.updateMany.mockResolvedValue({ count: 0 });
    expect(await claimProximoPedido("ws")).toBeNull();
    expect(state.pedidos.updateMany).toHaveBeenCalledTimes(3);
  });

  it("sem pedido devolve data null", async () => {
    state.pedidos.findFirst.mockResolvedValueOnce(null);
    const res = await claim(req("/api/agentes/claim"));
    expect(await res.json()).toEqual({ data: null });
    expect(state.pedidos.updateMany).not.toHaveBeenCalled();
  });

  it("sem Bearer → 401, sem escopo agentes:rw → 403", async () => {
    expect((await claim(req("/api/agentes/claim", undefined, {}))).status).toBe(401);
    state.keys.findUnique.mockResolvedValueOnce({ ...key, scopes: ["campaigns:read"] });
    expect((await claim(req("/api/agentes/claim"))).status).toBe(403);
    expect(state.pedidos.findFirst).not.toHaveBeenCalled();
  });
});

describe("resposta do runner", () => {
  it("grava FEITO só em pedido EM_ANDAMENTO do workspace", async () => {
    const res = await responder(req("/api/agentes/p1/resposta", { status: "FEITO", resposta: "ok" }), params("p1"));
    expect(res.status).toBe(200);
    const call = state.pedidos.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: "p1", workspaceId: "ws", status: "EM_ANDAMENTO" });
    expect(call.data).toMatchObject({ status: "FEITO", resposta: "ok" });
    expect(call.data.concluidoEm).toBeInstanceOf(Date);
  });

  it("409 se o pedido não está em andamento", async () => {
    state.pedidos.updateMany.mockResolvedValueOnce({ count: 0 });
    const res = await responder(req("/api/agentes/p1/resposta", { status: "ERRO", resposta: "falhou" }), params("p1"));
    expect(res.status).toBe(409);
  });

  it.each([{ status: "NOVO", resposta: "x" }, { status: "FEITO" }, { status: "FEITO", resposta: "x".repeat(20001) }])(
    "400 para corpo inválido %#", async (body) => {
      expect((await responder(req("/api/agentes/p1/resposta", body), params("p1"))).status).toBe(400);
      expect(state.pedidos.updateMany).not.toHaveBeenCalled();
    });

  it("sem escopo → 403", async () => {
    state.keys.findUnique.mockResolvedValueOnce({ ...key, scopes: ["redes:write"] });
    expect((await responder(req("/api/agentes/p1/resposta", { status: "FEITO", resposta: "ok" }), params("p1"))).status).toBe(403);
  });
});

describe("rotas de sessão", () => {
  it("GET sem sessão → 401", async () => {
    state.workspaceId.mockResolvedValueOnce(null);
    expect((await listar(new Request("https://example.test/api/agentes"))).status).toBe(401);
  });

  it("GET resumo devolve os 3 agentes do chat", async () => {
    state.pedidos.findMany.mockResolvedValueOnce([{ agente: "social-distribuicao", status: "EM_ANDAMENTO", updatedAt: new Date(0) }]);
    const json = await (await listar(new Request("https://example.test/api/agentes"))).json();
    expect(json.data.map((d: { agente: string }) => d.agente)).toEqual([...AGENTES_CHAT]);
    expect(json.data.find((d: { agente: string }) => d.agente === "social-distribuicao").ativo).toBe(true);
  });

  it("POST cria pedido NOVO para agente válido e recusa agente fora da lista", async () => {
    state.pedidos.create.mockImplementation(async ({ data }) => ({ id: "n1", ...data, status: "NOVO" }));
    const headers = { "content-type": "application/json", origin: "https://example.test" };
    const ok = await enviar(req("/api/agentes", { agente: "roteirista-copywriter", mensagem: "7 roteiros" }, headers));
    expect(ok.status).toBe(201);
    expect(state.pedidos.create.mock.calls[0][0].data).toEqual({ workspaceId: "ws", agente: "roteirista-copywriter", mensagem: "7 roteiros" });
    expect((await enviar(req("/api/agentes", { agente: "ceo", mensagem: "x" }, headers))).status).toBe(400);
  });

  it("POST de MEMBER → 403", async () => {
    state.context.mockResolvedValueOnce({ workspaceId: "ws", role: "MEMBER" });
    const res = await enviar(req("/api/agentes", { agente: "editor-de-videos", mensagem: "x" }, { "content-type": "application/json" }));
    expect(res.status).toBe(403);
  });
});

describe("estaAtivo", () => {
  const agora = new Date("2026-11-08T12:00:00Z");
  it("ativo com pedido EM_ANDAMENTO mesmo antigo", () => {
    expect(estaAtivo([{ status: "EM_ANDAMENTO", updatedAt: new Date("2026-11-01T00:00:00Z") }], agora)).toBe(true);
  });
  it("ativo com atividade nos últimos 15 minutos", () => {
    expect(estaAtivo([{ status: "FEITO", updatedAt: new Date("2026-11-08T11:50:00Z") }], agora)).toBe(true);
  });
  it("inativo com atividade antiga ou sem pedidos", () => {
    expect(estaAtivo([{ status: "FEITO", updatedAt: "2026-11-08T11:30:00Z" }], agora)).toBe(false);
    expect(estaAtivo([], agora)).toBe(false);
  });
});
