import { describe, expect, it, vi } from "vitest";
import type { LogDm } from "@/lib/opi/dashboard-dados";
import {
  buscarFunil,
  diasAteMeta,
  etapasFormulario,
  funilSchema,
  materialDaPalavra,
  montarFunil,
  semanasDoFunil,
  TIMEOUT_FUNIL_MS,
} from "@/lib/opi/leads-funil";

const log = (palavra: string | null, status: string, extra: Partial<LogDm> = {}): LogDm => ({
  createdAt: new Date("2026-11-10T12:00:00Z"),
  dmSentAt: status === "SENT" ? new Date("2026-11-10T12:00:05Z") : null,
  status,
  matchedKeyword: palavra,
  campanha: "Campanha",
  campanhaAtiva: true,
  ...extra,
});

const FUNIL = {
  atualizadoEm: "2026-11-12T12:00:00.000Z",
  materiais: [
    { id: "termos", aberturas: 40, envios: 30, leads: 28, aceiteContato: 21 },
    { id: "juros", aberturas: 10, envios: 10, leads: 10, aceiteContato: 0 },
  ],
  porSemana: [
    { semana: "2026-11-09", leads: 20 },
    { semana: "2026-11-02", leads: 10 },
  ],
};

describe("materialDaPalavra", () => {
  it("mapeia as cinco palavras, com acento, minúscula e singular", () => {
    expect(materialDaPalavra("TERMOS")).toBe("termos");
    expect(materialDaPalavra("termo")).toBe("termos");
    expect(materialDaPalavra("JUROS")).toBe("juros");
    expect(materialDaPalavra("ERROS")).toBe("erros");
    expect(materialDaPalavra(" Estratégias ")).toBe("estrategias");
    expect(materialDaPalavra("ESTRATEGIA")).toBe("estrategias");
    expect(materialDaPalavra("COBERTA")).toBe("coberta");
    expect(materialDaPalavra("DIARIO")).toBeNull();
  });
});

describe("funilSchema", () => {
  it("descarta qualquer campo extra: nome e telefone não passam", () => {
    const lido = funilSchema.parse({
      ...FUNIL,
      leadsDetalhe: [{ nome: "Fulano", telefone: "11999990000" }],
      materiais: [{ ...FUNIL.materiais[0], nome: "Fulano de Tal", telefone: "11999990000", email: "a@b.com" }],
      porSemana: [{ semana: "2026-11-09", leads: 3, nomes: ["Fulano"] }],
    });
    const texto = JSON.stringify(lido);
    expect(texto).not.toMatch(/Fulano|11999990000|a@b\.com|nome|telefone/);
    expect(lido.materiais[0]).toEqual({ id: "termos", aberturas: 40, envios: 30, leads: 28, aceiteContato: 21 });
  });

  it("aceita número como texto (planilha) e recusa contagem inválida", () => {
    expect(funilSchema.parse({ ...FUNIL, materiais: [{ id: "TERMOS", aberturas: "4", envios: "3", leads: 3, aceiteContato: 1 }] }).materiais[0]).toEqual({
      id: "termos",
      aberturas: 4,
      envios: 3,
      leads: 3,
      aceiteContato: 1,
    });
    expect(funilSchema.safeParse({ ...FUNIL, materiais: [{ id: "termos", aberturas: -1, envios: 0, leads: 0, aceiteContato: 0 }] }).success).toBe(false);
    expect(funilSchema.safeParse({ ...FUNIL, atualizadoEm: "ontem" }).success).toBe(false);
    expect(funilSchema.safeParse({ materiais: [] }).success).toBe(false);
  });

  it("porSemana é opcional", () => {
    expect(funilSchema.parse({ atualizadoEm: FUNIL.atualizadoEm, materiais: [] }).porSemana).toEqual([]);
  });
});

describe("buscarFunil", () => {
  const ENV = { OPI_FUNIL_URL: "https://n8n.exemplo/webhook/funil", OPI_FUNIL_SECRET: "s3gredo" };
  const resposta = (corpo: unknown, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });

  it("sem as variáveis: não configurada, sem chamar a rede", async () => {
    const f = vi.fn();
    expect(await buscarFunil({}, f)).toEqual({ ok: false, motivo: "nao_configurada" });
    expect(await buscarFunil({ OPI_FUNIL_URL: ENV.OPI_FUNIL_URL }, f)).toEqual({ ok: false, motivo: "nao_configurada" });
    expect(f).not.toHaveBeenCalled();
  });

  it("chama o webhook com o segredo no cabeçalho, sem cache e com limite de 8 s", async () => {
    const f = vi.fn(async () => resposta(FUNIL));
    const r = await buscarFunil(ENV, f);
    expect(r).toEqual({ ok: true, dados: FUNIL });
    expect(TIMEOUT_FUNIL_MS).toBe(8000);
    const [url, init] = f.mock.calls[0] as unknown as [string, { method: string; headers: Record<string, string>; cache: string; signal: AbortSignal }];
    expect(url).toBe(ENV.OPI_FUNIL_URL);
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ "x-opi-secret": "s3gredo" });
    expect(init.cache).toBe("no-store");
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("erro HTTP, JSON fora do contrato ou rede caída: indisponível, sem lançar", async () => {
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await buscarFunil(ENV, vi.fn(async () => resposta({}, 500)))).toEqual({ ok: false, motivo: "indisponivel" });
      expect(await buscarFunil(ENV, vi.fn(async () => resposta({ oi: 1 })))).toEqual({ ok: false, motivo: "indisponivel" });
      expect(await buscarFunil(ENV, vi.fn(async () => { throw new Error("timeout"); }))).toEqual({ ok: false, motivo: "indisponivel" });
      // O segredo e a URL nunca vão ao log.
      expect(JSON.stringify(silencio.mock.calls)).not.toMatch(/s3gredo|n8n\.exemplo/);
    } finally {
      silencio.mockRestore();
    }
  });
});

describe("etapasFormulario", () => {
  it("desistência = (aberturas − envios) ÷ aberturas; aceite = aceite ÷ leads", () => {
    expect(etapasFormulario({ aberturas: 40, envios: 30, leads: 28, aceiteContato: 21 })).toMatchObject({ desistenciaPct: 25, aceitePct: 75 });
  });
  it("sem abertura não há desistência; sem leads usa os envios; nunca passa de 100% nem fica negativa", () => {
    expect(etapasFormulario({ aberturas: 0, envios: 0, leads: 0, aceiteContato: 0 })).toMatchObject({ desistenciaPct: null, aceitePct: null });
    expect(etapasFormulario({ aberturas: 10, envios: 12, leads: 0, aceiteContato: 6 })).toMatchObject({ desistenciaPct: 0, aceitePct: 50 });
    expect(etapasFormulario({ aberturas: 10, envios: 5, leads: 2, aceiteContato: 3 }).aceitePct).toBe(100);
  });
});

describe("montarFunil", () => {
  const logs = [
    log("TERMOS", "SENT"),
    log("TERMOS", "SENT"),
    log("termo", "FAILED"),
    log("TERMOS", "HELD_FOR_REVIEW"),
    log("JUROS", "SENT"),
    log("DIARIO", "SENT"),
    log(null, "SKIPPED_NO_MATCH"),
    log("COBERTA", "SENT", { campanhaAtiva: false }), // campanha desativada (teste) não conta
  ];

  it("junta DmLog e webhook por material, na ordem fixa dos cinco", () => {
    const f = montarFunil(logs, FUNIL);
    expect(f.linhas.map((l) => l.id)).toEqual(["termos", "juros", "erros", "estrategias", "coberta"]);
    const termos = f.linhas[0];
    expect(termos).toMatchObject({ comentarios: 4, dms: 2, taxaDmPct: 50 });
    expect(termos.palavras.sort()).toEqual(["TERMO", "TERMOS"]);
    expect(termos.formulario).toMatchObject({ aberturas: 40, envios: 30, desistenciaPct: 25, aceitePct: 75 });
    expect(f.linhas[4]).toMatchObject({ id: "coberta", comentarios: 0, dms: 0, taxaDmPct: null });
    expect(f.linhas[2].formulario).toMatchObject({ aberturas: 0, envios: 0, desistenciaPct: null });
    expect(f.outras.map((l) => l.nome)).toEqual(["DIARIO"]);
    expect(f.total).toEqual({ comentarios: 5, dms: 3, aberturas: 50, envios: 40, leads: 38, aceiteContato: 21 });
    expect(f.leadsComContato).toBe(21);
  });

  it("sem a fonte de leads as etapas do DmLog continuam e o formulário fica nulo", () => {
    const f = montarFunil(logs, null);
    expect(f.linhas[0]).toMatchObject({ comentarios: 4, dms: 2, formulario: null });
    expect(f.leadsComContato).toBeNull();
    expect(f.total.aberturas).toBe(0);
  });

  it("material novo no webhook aparece no fim; material repetido soma", () => {
    const f = montarFunil([], {
      ...FUNIL,
      materiais: [...FUNIL.materiais, { id: "termos", aberturas: 1, envios: 1, leads: 1, aceiteContato: 1 }, { id: "diario", aberturas: 5, envios: 2, leads: 2, aceiteContato: 1 }],
    });
    expect(f.linhas.map((l) => l.id)).toEqual(["termos", "juros", "erros", "estrategias", "coberta", "diario"]);
    expect(f.linhas[0].formulario).toMatchObject({ aberturas: 41, aceiteContato: 22 });
    expect(f.leadsComContato).toBe(23);
  });
});

describe("meta e semanas", () => {
  it("diasAteMeta conta até o fim de 13/12 em São Paulo e não fica negativo", () => {
    expect(diasAteMeta(new Date("2026-12-13T12:00:00-03:00"))).toBe(1);
    expect(diasAteMeta(new Date("2026-12-12T23:59:59-03:00"))).toBe(1);
    expect(diasAteMeta(new Date("2026-11-13T23:59:59-03:00"))).toBe(30);
    expect(diasAteMeta(new Date("2026-12-20T00:00:00-03:00"))).toBe(0);
  });

  it("semanasDoFunil ordena e calcula a barra pela melhor semana", () => {
    expect(semanasDoFunil(FUNIL.porSemana)).toEqual([
      { semana: "2026-11-02", rotulo: "02/11", leads: 10, largura: 50 },
      { semana: "2026-11-09", rotulo: "09/11", leads: 20, largura: 100 },
    ]);
    expect(semanasDoFunil([{ semana: "2026-11-02", leads: 0 }])[0].largura).toBe(0);
    expect(semanasDoFunil([])).toEqual([]);
  });
});
