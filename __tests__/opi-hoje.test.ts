import { describe, expect, it, vi } from "vitest";
import { carregarHoje, montarErros24h, montarEsperando, montarSaiHoje, rotuloStatusPost, tomDoStatus, type DbHoje } from "@/lib/opi/hoje";

const AGORA = new Date("2026-11-12T15:00:00.000Z"); // 12:00 em São Paulo

describe("montarSaiHoje", () => {
  it("ordena por hora e liga as campanhas presas ao post (agendado:<id>)", () => {
    const r = montarSaiHoje(
      [
        { id: "p2", tipo: "REEL", status: "APROVADO", agendadoPara: new Date("2026-11-12T21:00:00Z"), legenda: "Reel das 18h\ncom quebra", permalink: null },
        { id: "p1", tipo: "CARROSSEL", status: "PUBLICADO", agendadoPara: new Date("2026-11-12T12:00:00Z"), legenda: null, permalink: "https://instagram.com/p/x" },
      ],
      [
        { name: "TERMOS", isActive: true, postUrl: "agendado:p2" },
        { name: "Outra", isActive: false, postUrl: "agendado:p2" },
        { name: "Solta", isActive: true, postUrl: "https://instagram.com/reel/abc" },
        { name: "Sem alvo", isActive: true, postUrl: null },
      ],
    );
    expect(r.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(r[0].campanhas).toEqual([]);
    expect(r[0].legenda).toBe("");
    expect(r[1].legenda).toBe("Reel das 18h com quebra");
    expect(r[1].campanhas).toEqual([
      { nome: "TERMOS", ativa: true },
      { nome: "Outra", ativa: false },
    ]);
  });
});

describe("montarErros24h e montarEsperando", () => {
  it("cada erro leva para a tela que resolve", () => {
    const itens = montarErros24h({
      postsComErro: [{ tipo: "REEL", erro: "Graph 400: vídeo recusado" }],
      dmsFalhas: 2,
      eventosPorFonte: [
        { source: "TOKEN_REFRESH", total: 1 },
        { source: "WORKER", total: 0 },
      ],
    });
    expect(itens).toEqual([
      { texto: "Reel não publicado: Graph 400: vídeo recusado", href: "/dashboard/calendario", nivel: "erro" },
      { texto: "2 DMs falharam no envio", href: "/logs", nivel: "erro" },
      { texto: "1 erro registrado na renovação do token do Instagram", href: "/diagnostics", nivel: "erro" },
    ]);
    expect(montarErros24h({ postsComErro: [], dmsFalhas: 0, eventosPorFonte: [] })).toEqual([]);
  });

  it("o que espera o Luan: rascunhos e DMs seguradas", () => {
    expect(montarEsperando({ rascunhos: 1, dmsSeguradas: 3 })).toEqual([
      { texto: "1 rascunho no calendário aguardando sua aprovação", href: "/dashboard/calendario", nivel: "normal" },
      { texto: "3 DMs seguradas para revisão", href: "/dashboard/palavras", nivel: "normal" },
    ]);
    expect(montarEsperando({ rascunhos: 0, dmsSeguradas: 0 })).toEqual([]);
  });

  it("rótulos de status", () => {
    expect(rotuloStatusPost("APROVADO")).toBe("Agendado");
    expect(tomDoStatus("ERRO")).toBe("error");
    expect(tomDoStatus("PUBLICADO")).toBe("success");
    expect(tomDoStatus("RASCUNHO")).toBe("neutral");
  });
});

describe("carregarHoje", () => {
  function banco() {
    return {
      postAgendado: {
        findMany: vi.fn(async ({ where }: { where: { status?: string } }) =>
          where.status === "ERRO"
            ? [{ tipo: "REEL", erro: "falhou" }]
            : [{ id: "p1", tipo: "REEL", status: "APROVADO", agendadoPara: new Date("2026-11-12T21:00:00Z"), legenda: "Oi", permalink: null }],
        ),
        count: vi.fn(async () => 2),
      },
      automation: { findMany: vi.fn(async () => [{ name: "TERMOS", isActive: true, postUrl: "agendado:p1" }]) },
      dmLog: { count: vi.fn(async ({ where }: { where: { status: string } }) => (where.status === "FAILED" ? 1 : 4)) },
      operationalEvent: { groupBy: vi.fn(async () => [{ source: "WORKER", _count: { _all: 3 } }]) },
    };
  }

  it("usa o dia de São Paulo, as últimas 24 h e o workspace em todas as consultas", async () => {
    const db = banco();
    const h = await carregarHoje(db as unknown as DbHoje, "w1", AGORA);

    const hoje = db.postAgendado.findMany.mock.calls.map((c) => c[0] as unknown as { where: { workspaceId: string; agendadoPara?: { gte: Date; lt: Date } } }).find((a) => a.where.agendadoPara)!;
    expect(hoje.where.workspaceId).toBe("w1");
    expect(hoje.where.agendadoPara!.gte.toISOString()).toBe("2026-11-12T03:00:00.000Z");
    expect(hoje.where.agendadoPara!.lt.toISOString()).toBe("2026-11-13T03:00:00.000Z");
    expect(db.automation.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "w1", postUrl: { in: ["agendado:p1"] } } }));
    const evento = (db.operationalEvent.groupBy.mock.calls[0] as unknown as [{ where: { level: string; createdAt: { gte: Date } } }])[0];
    expect(evento.where.level).toBe("ERROR");
    expect(evento.where.createdAt.gte.toISOString()).toBe("2026-11-11T15:00:00.000Z");

    expect(h.saiHoje.ok && h.saiHoje.dados[0].campanhas).toEqual([{ nome: "TERMOS", ativa: true }]);
    expect(h.erros.ok && h.erros.dados.map((i) => i.texto)).toEqual([
      "Reel não publicado: falhou",
      "1 DM falhou no envio",
      "3 erros registrados no envio de DMs",
    ]);
    expect(h.esperando.ok && h.esperando.dados.map((i) => i.texto)).toEqual([
      "2 rascunhos no calendário aguardando sua aprovação",
      "4 DMs seguradas para revisão",
    ]);
  });

  it("uma consulta que falha não derruba as outras", async () => {
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const db = banco();
      db.operationalEvent.groupBy.mockRejectedValue(new Error("fora"));
      db.automation.findMany.mockRejectedValue(new Error("fora"));
      db.postAgendado.count.mockRejectedValue(new Error("fora"));
      const h = await carregarHoje(db as unknown as DbHoje, "w1", AGORA);
      expect(h.saiHoje.ok && h.saiHoje.dados[0]).toMatchObject({ id: "p1", campanhas: [] });
      expect(h.erros.ok && h.erros.dados).toHaveLength(2);
      expect(h.esperando.ok && h.esperando.dados.map((i) => i.texto)).toEqual(["4 DMs seguradas para revisão"]);

      db.dmLog.count.mockRejectedValue(new Error("fora"));
      const h2 = await carregarHoje(db as unknown as DbHoje, "w1", AGORA);
      expect(h2.esperando).toEqual({ ok: false, motivo: "erro" });
      expect(h2.erros.ok).toBe(true);
    } finally {
      silencio.mockRestore();
    }
  });
});
