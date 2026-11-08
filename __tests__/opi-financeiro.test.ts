import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma, mockWorkspaceId, mockContext } = vi.hoisted(() => ({
  mockPrisma: {
    lancamento: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  mockWorkspaceId: vi.fn(),
  mockContext: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: mockWorkspaceId }));
vi.mock("@/lib/workspace-access", () => ({
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
  getCurrentWorkspaceContext: mockContext,
}));

import { GET, POST } from "../app/api/opi/financeiro/route";
import { DELETE, PATCH } from "../app/api/opi/financeiro/[id]/route";
import {
  deCentavos,
  filtroMes,
  lancamentoSchema,
  paraCentavos,
  porMes,
  resumo,
  ultimosMeses,
} from "../lib/opi/financeiro";

const BASE = "https://example.com/api/opi/financeiro";

function req(url: string, init?: { method?: string; body?: unknown }) {
  return new NextRequest(url, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json" },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

const linha = {
  id: "l1",
  workspaceId: "ws_1",
  data: new Date("2026-10-27T12:00:00.000Z"),
  tipo: "DESPESA",
  categoria: "Ferramentas IA",
  descricao: "Kairogen Pro",
  valor: "149",
  status: "PAGO",
  createdAt: new Date(),
  updatedAt: new Date(),
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkspaceId.mockResolvedValue("ws_1");
  mockContext.mockResolvedValue({ workspaceId: "ws_1", role: "OWNER" });
  mockPrisma.lancamento.findMany.mockResolvedValue([]);
  mockPrisma.lancamento.create.mockImplementation(async ({ data }) => ({ id: "novo", ...data }));
  mockPrisma.lancamento.update.mockImplementation(async ({ data }) => ({ ...linha, ...data }));
  mockPrisma.lancamento.delete.mockResolvedValue(linha);
});

describe("GET /api/opi/financeiro", () => {
  it("401 sem sessão", async () => {
    mockWorkspaceId.mockResolvedValue(null);
    const res = await GET(req(BASE));
    expect(res.status).toBe(401);
    expect(mockPrisma.lancamento.findMany).not.toHaveBeenCalled();
  });

  it("filtra por mês e tipo no workspace da sessão e devolve resumo e porMes", async () => {
    mockPrisma.lancamento.findMany
      .mockResolvedValueOnce([linha])
      .mockResolvedValueOnce([{ data: linha.data, tipo: "DESPESA", valor: "149" }]);

    const res = await GET(req(`${BASE}?mes=2026-10&tipo=despesa`));
    expect(res.status).toBe(200);

    const where = mockPrisma.lancamento.findMany.mock.calls[0][0].where;
    expect(where).toEqual({
      workspaceId: "ws_1",
      tipo: "DESPESA",
      data: { gte: new Date("2026-10-01T00:00:00.000Z"), lt: new Date("2026-11-01T00:00:00.000Z") },
    });
    const janela = mockPrisma.lancamento.findMany.mock.calls[1][0].where;
    expect(janela.data).toEqual({
      gte: new Date("2026-05-01T00:00:00.000Z"),
      lt: new Date("2026-11-01T00:00:00.000Z"),
    });

    const json = await res.json();
    expect(json.data[0].valor).toBe("149.00");
    expect(json.resumo).toEqual({ receita: 0, despesa: 14900, saldo: -14900, previsto: 0, pago: -14900 });
    expect(json.porMes).toHaveLength(6);
    expect(json.porMes[5]).toEqual({ mes: "2026-10", receita: 0, despesa: 14900 });
  });

  it("400 com tipo inválido", async () => {
    const res = await GET(req(`${BASE}?tipo=ADS`));
    expect(res.status).toBe(400);
  });

  it("400 com mês inválido", async () => {
    const res = await GET(req(`${BASE}?mes=2026-13`));
    expect(res.status).toBe(400);
  });
});

describe("POST /api/opi/financeiro", () => {
  const corpo = {
    data: "2026-11-05",
    tipo: "DESPESA",
    categoria: "Ferramentas",
    descricao: "Teste",
    valor: "10,5",
  };

  it("401 sem sessão", async () => {
    mockContext.mockResolvedValue(null);
    const res = await POST(req(BASE, { method: "POST", body: corpo }));
    expect(res.status).toBe(401);
  });

  it("403 para MEMBER", async () => {
    mockContext.mockResolvedValue({ workspaceId: "ws_1", role: "MEMBER" });
    const res = await POST(req(BASE, { method: "POST", body: corpo }));
    expect(res.status).toBe(403);
    expect(mockPrisma.lancamento.create).not.toHaveBeenCalled();
  });

  it("400 com valor zero ou negativo", async () => {
    for (const valor of ["0", "-5", 0, "abc"]) {
      const res = await POST(req(BASE, { method: "POST", body: { ...corpo, valor } }));
      expect(res.status).toBe(400);
    }
    expect(mockPrisma.lancamento.create).not.toHaveBeenCalled();
  });

  it("201 grava no workspace do contexto, ignora workspaceId do corpo, status padrão PREVISTO", async () => {
    const res = await POST(req(BASE, { method: "POST", body: { ...corpo, workspaceId: "ws_outro" } }));
    expect(res.status).toBe(201);
    const { data } = mockPrisma.lancamento.create.mock.calls[0][0];
    expect(data.workspaceId).toBe("ws_1");
    expect(data.valor).toBe("10.50");
    expect(data.status).toBe("PREVISTO");
    expect(data.data).toEqual(new Date("2026-11-05T12:00:00.000Z"));
    const json = await res.json();
    expect(json.data.valor).toBe("10.50");
  });
});

describe("PATCH/DELETE /api/opi/financeiro/[id]", () => {
  it("PATCH 404 para lançamento de outro workspace", async () => {
    mockPrisma.lancamento.findFirst.mockResolvedValue(null);
    const res = await PATCH(req(`${BASE}/l9`, { method: "PATCH", body: { status: "PAGO" } }), params("l9"));
    expect(res.status).toBe(404);
    expect(mockPrisma.lancamento.findFirst).toHaveBeenCalledWith({
      where: { id: "l9", workspaceId: "ws_1" },
      select: { id: true },
    });
    expect(mockPrisma.lancamento.update).not.toHaveBeenCalled();
  });

  it("PATCH atualiza só os campos enviados", async () => {
    mockPrisma.lancamento.findFirst.mockResolvedValue({ id: "l1" });
    const res = await PATCH(req(`${BASE}/l1`, { method: "PATCH", body: { status: "PAGO" } }), params("l1"));
    expect(res.status).toBe(200);
    expect(mockPrisma.lancamento.update).toHaveBeenCalledWith({ where: { id: "l1" }, data: { status: "PAGO" } });
  });

  it("PATCH 400 com corpo vazio", async () => {
    const res = await PATCH(req(`${BASE}/l1`, { method: "PATCH", body: {} }), params("l1"));
    expect(res.status).toBe(400);
  });

  it("PATCH 403 para MEMBER", async () => {
    mockContext.mockResolvedValue({ workspaceId: "ws_1", role: "MEMBER" });
    const res = await PATCH(req(`${BASE}/l1`, { method: "PATCH", body: { status: "PAGO" } }), params("l1"));
    expect(res.status).toBe(403);
  });

  it("DELETE apaga do workspace", async () => {
    mockPrisma.lancamento.findFirst.mockResolvedValue({ id: "l1" });
    const res = await DELETE(req(`${BASE}/l1`, { method: "DELETE" }), params("l1"));
    expect(res.status).toBe(200);
    expect(mockPrisma.lancamento.delete).toHaveBeenCalledWith({ where: { id: "l1" } });
  });

  it("DELETE 404 de outro workspace", async () => {
    mockPrisma.lancamento.findFirst.mockResolvedValue(null);
    const res = await DELETE(req(`${BASE}/l9`, { method: "DELETE" }), params("l9"));
    expect(res.status).toBe(404);
    expect(mockPrisma.lancamento.delete).not.toHaveBeenCalled();
  });
});

describe("lib/opi/financeiro", () => {
  it("soma em centavos sem erro de float", () => {
    const r = resumo([
      { tipo: "RECEITA", valor: "0.1", status: "PAGO" },
      { tipo: "RECEITA", valor: "0.2", status: "PREVISTO" },
      { tipo: "DESPESA", valor: "0.3", status: "PAGO" },
    ]);
    expect(r).toEqual({ receita: 30, despesa: 30, saldo: 0, previsto: 20, pago: -20 });
  });

  it("paraCentavos e deCentavos", () => {
    expect(paraCentavos("149")).toBe(14900);
    expect(paraCentavos("149.9")).toBe(14990);
    expect(paraCentavos(10.05)).toBe(1005);
    expect(deCentavos(14990)).toBe("149.90");
    expect(deCentavos(-5)).toBe("-0.05");
  });

  it("filtroMes valida e vira o ano em dezembro", () => {
    expect(filtroMes("2026-12")).toEqual({
      gte: new Date("2026-12-01T00:00:00.000Z"),
      lt: new Date("2027-01-01T00:00:00.000Z"),
    });
    expect(() => filtroMes("2026-1")).toThrow();
  });

  it("ultimosMeses atravessa o ano", () => {
    expect(ultimosMeses("2026-02", 3)).toEqual(["2025-12", "2026-01", "2026-02"]);
  });

  it("porMes preenche meses vazios e ignora fora da janela", () => {
    const barras = porMes(
      [
        { tipo: "DESPESA", valor: "149", data: new Date("2026-09-27T12:00:00Z") },
        { tipo: "RECEITA", valor: "50", data: new Date("2026-10-02T12:00:00Z") },
        { tipo: "DESPESA", valor: "1", data: new Date("2025-01-01T12:00:00Z") },
      ],
      ["2026-09", "2026-10", "2026-11"]
    );
    expect(barras).toEqual([
      { mes: "2026-09", receita: 0, despesa: 14900 },
      { mes: "2026-10", receita: 5000, despesa: 0 },
      { mes: "2026-11", receita: 0, despesa: 0 },
    ]);
  });

  it("schema aceita vírgula e rejeita data inválida", () => {
    const ok = lancamentoSchema.safeParse({
      data: "2026-11-01",
      tipo: "RECEITA",
      categoria: "Vendas",
      descricao: "x",
      valor: "1.234,56",
    });
    expect(ok.success && ok.data.valor).toBe("1234.56");
    const ruim = lancamentoSchema.safeParse({
      data: "ontem",
      tipo: "RECEITA",
      categoria: "Vendas",
      descricao: "x",
      valor: "1",
    });
    expect(ruim.success).toBe(false);
  });
});
