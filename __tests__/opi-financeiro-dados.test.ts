import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma, mockWorkspaceId } = vi.hoisted(() => ({
  mockPrisma: { lancamento: { findMany: vi.fn() } },
  mockWorkspaceId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: mockWorkspaceId }));

import { GET } from "../app/api/opi/financeiro/painel/route";
import {
  burnMedio,
  montarPainel,
  porCategoria,
  previstoPago,
  serieMensal,
  variacao,
  type LinhaFin,
} from "../lib/opi/financeiro-dados";

const d = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

const LANC: LinhaFin[] = [
  { data: d("2026-08-10"), tipo: "DESPESA", valor: "100", status: "PAGO", categoria: "Ferramentas IA" },
  { data: d("2026-09-05"), tipo: "RECEITA", valor: "500", status: "PAGO", categoria: "Vendas" },
  { data: d("2026-09-20"), tipo: "DESPESA", valor: "200", status: "PAGO", categoria: "Ferramentas IA" },
  { data: d("2026-10-01"), tipo: "DESPESA", valor: "149.90", status: "PAGO", categoria: "Ferramentas IA" },
  { data: d("2026-10-15"), tipo: "DESPESA", valor: "50", status: "PREVISTO", categoria: "Domínio" },
  { data: d("2026-10-20"), tipo: "RECEITA", valor: "300", status: "PREVISTO", categoria: "Vendas" },
];

describe("serieMensal", () => {
  it("soma por mês e acumula o saldo, incluindo o que veio antes da janela", () => {
    const s = serieMensal(LANC, ["2026-09", "2026-10", "2026-11"]);
    expect(s).toEqual([
      { mes: "2026-09", receita: 50000, despesa: 20000, saldo: 30000, acumulado: 20000 },
      { mes: "2026-10", receita: 30000, despesa: 19990, saldo: 10010, acumulado: 30010 },
      { mes: "2026-11", receita: 0, despesa: 0, saldo: 0, acumulado: 30010 },
    ]);
  });

  it("sem lançamentos devolve zeros", () => {
    expect(serieMensal([], ["2026-01"])).toEqual([{ mes: "2026-01", receita: 0, despesa: 0, saldo: 0, acumulado: 0 }]);
  });
});

describe("porCategoria", () => {
  it("ordena do maior para o menor com porcentagem", () => {
    expect(porCategoria(LANC)).toEqual([
      { categoria: "Ferramentas IA", valor: 44990, pct: 90 },
      { categoria: "Domínio", valor: 5000, pct: 10 },
    ]);
  });

  it("agrupa o excedente em Outras", () => {
    const muitas = ["a", "b", "c"].map((c, i) => ({ data: d("2026-10-01"), tipo: "DESPESA", valor: String(10 - i), categoria: c }));
    const f = porCategoria(muitas, "DESPESA", 2);
    expect(f.map((x) => x.categoria)).toEqual(["a", "b", "Outras"]);
    expect(f[2].valor).toBe(800);
  });

  it("vazio quando não há o tipo pedido", () => {
    expect(porCategoria(LANC.filter((l) => l.tipo === "RECEITA"), "DESPESA")).toEqual([]);
  });
});

describe("previstoPago", () => {
  it("separa pago e previsto do tipo pedido", () => {
    const out = LANC.filter((l) => String(l.data instanceof Date ? l.data.toISOString() : l.data).startsWith("2026-10"));
    expect(previstoPago(out, "DESPESA")).toEqual({ total: 19990, pago: 14990, previsto: 5000, pctPago: 75 });
    expect(previstoPago(out, "RECEITA")).toEqual({ total: 30000, pago: 0, previsto: 30000, pctPago: 0 });
    expect(previstoPago([], "DESPESA").pctPago).toBeNull();
  });
});

describe("burnMedio e variacao", () => {
  it("média dos últimos meses a partir do primeiro com lançamento", () => {
    const s = serieMensal(LANC, ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(burnMedio(s, "2026-10", 3)).toEqual({ valor: Math.round((10000 + 20000 + 19990) / 3), meses: 3 });
    // Em agosto só há 1 mês de histórico: não dilui com junho e julho vazios.
    expect(burnMedio(s, "2026-08", 3)).toEqual({ valor: 10000, meses: 1 });
    expect(burnMedio(serieMensal([], ["2026-01"]), "2026-01")).toEqual({ valor: null, meses: 0 });
  });

  it("variação percentual e sem base", () => {
    expect(variacao(150, 100)).toBe(50);
    expect(variacao(50, 100)).toBe(-50);
    expect(variacao(10, 0)).toBeNull();
  });
});

describe("montarPainel", () => {
  it("monta KPIs do mês com comparação ao anterior", () => {
    const p = montarPainel(LANC, "2026-10", 12);
    expect(p.serie).toHaveLength(12);
    expect(p.serie[11].mes).toBe("2026-10");
    expect(p.kpis).toMatchObject({ receita: 30000, despesa: 19990, saldo: 10010, receitaAnterior: 50000, despesaAnterior: 20000 });
    expect(p.kpis.burnMeses).toBe(3);
    expect(p.categoriasMes[0].categoria).toBe("Ferramentas IA");
    expect(p.despesasMes.pctPago).toBe(75);
    expect(p.temLancamentos).toBe(true);
  });

  it("sem lançamentos marca vazio", () => {
    const p = montarPainel([], "2026-10");
    expect(p.temLancamentos).toBe(false);
    expect(p.kpis.burnMedio).toBeNull();
    expect(p.categoriasMes).toEqual([]);
  });
});

describe("GET /api/opi/financeiro/painel", () => {
  const req = (q = "") => new NextRequest(`https://example.com/api/opi/financeiro/painel${q}`);

  beforeEach(() => {
    vi.clearAllMocks();
    mockWorkspaceId.mockResolvedValue("ws_1");
    mockPrisma.lancamento.findMany.mockResolvedValue(LANC);
  });

  it("401 sem sessão", async () => {
    mockWorkspaceId.mockResolvedValue(null);
    expect((await GET(req())).status).toBe(401);
    expect(mockPrisma.lancamento.findMany).not.toHaveBeenCalled();
  });

  it("400 com mês inválido", async () => {
    expect((await GET(req("?mes=2026-13"))).status).toBe(400);
  });

  it("busca só o workspace da sessão até o fim do mês e devolve o painel", async () => {
    const res = await GET(req("?mes=2026-10"));
    expect(res.status).toBe(200);
    const where = mockPrisma.lancamento.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ workspaceId: "ws_1", data: { lt: new Date("2026-11-01T00:00:00.000Z") } });
    const json = await res.json();
    expect(json.data.mes).toBe("2026-10");
    expect(json.data.kpis.saldo).toBe(10010);
  });
});
