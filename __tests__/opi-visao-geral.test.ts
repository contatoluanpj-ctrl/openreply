import { describe, it, expect, vi } from "vitest";
import {
  AVISO_OBRIGATORIO,
  LINKS,
  bloco,
  carregarVisaoGeral,
  janelas,
  montarPendencias,
  paraNumero,
  seguidoresDasMetricas,
  type DbVisao,
  type VisaoGeral,
} from "../lib/opi/visao-geral";

const p2021 = () => Object.assign(new Error("The table `public.RedeSnapshot` does not exist"), { code: "P2021" });

type Opcoes = {
  redes?: unknown[] | Error;
  contasIg?: unknown[];
  postsSemana?: unknown[] | Error;
  postsFuturos?: unknown[];
  dmCounts?: [number, number, number];
  pausadas?: { id: string; name: string }[];
  totalPausadas?: number;
  freio?: "opi.freio.pausar" | "opi.freio.retomar" | null;
  lancamentos?: unknown[];
  vencidos?: number;
  pedidos?: unknown[];
  pedidosTotal?: number;
  pedidosErro?: number;
};

function fakeDb(o: Opcoes = {}) {
  const resolve = <T>(v: T | Error) => (v instanceof Error ? Promise.reject(v) : Promise.resolve(v));
  const dmCounts = [...(o.dmCounts ?? [0, 0, 0])];
  const pedidoCounts = [o.pedidosTotal ?? 0, o.pedidosErro ?? 0];
  const db = {
    redeSnapshot: { findMany: vi.fn(() => resolve(o.redes ?? [])) },
    instagramAccount: { findMany: vi.fn(async () => o.contasIg ?? []) },
    followerSnapshot: {},
    postAgendado: {
      findMany: vi.fn(({ where }: { where: { status?: unknown } }) =>
        where.status ? resolve(o.postsFuturos ?? []) : resolve(o.postsSemana ?? []),
      ),
    },
    dmLog: { count: vi.fn(async () => dmCounts.shift() ?? 0) },
    automation: {
      findMany: vi.fn(async () => o.pausadas ?? []),
      count: vi.fn(async () => o.totalPausadas ?? 0),
    },
    operationalEvent: { findFirst: vi.fn(async () => (o.freio ? { message: o.freio, payload: null } : null)) },
    lancamento: {
      findMany: vi.fn(async () => o.lancamentos ?? []),
      count: vi.fn(async () => o.vencidos ?? 0),
    },
    pedidoAgente: {
      findMany: vi.fn(async () => o.pedidos ?? []),
      count: vi.fn(async () => pedidoCounts.shift() ?? 0),
    },
  };
  return db as unknown as DbVisao & typeof db;
}

// 08/11/2026 é domingo. 02:30 UTC = 07/11 23:30 em SP (sábado).
const AGORA = new Date("2026-11-08T15:00:00Z"); // domingo 12:00 em SP

describe("janelas (America/Sao_Paulo)", () => {
  it("início de hoje é meia-noite de SP (03:00 UTC)", () => {
    const j = janelas(AGORA);
    expect(j.inicioHoje.toISOString()).toBe("2026-11-08T03:00:00.000Z");
    expect(j.inicio7Dias.toISOString()).toBe("2026-11-02T03:00:00.000Z");
  });

  it("antes das 03:00 UTC ainda é o dia anterior em SP", () => {
    const j = janelas(new Date("2026-11-08T02:30:00Z"));
    expect(j.inicioHoje.toISOString()).toBe("2026-11-07T03:00:00.000Z");
  });

  it("semana vai de segunda a domingo; domingo pertence à semana que começou na segunda anterior", () => {
    const j = janelas(AGORA);
    expect(j.inicioSemana.toISOString()).toBe("2026-11-02T03:00:00.000Z");
    expect(j.fimSemana.toISOString()).toBe("2026-11-09T03:00:00.000Z");
    const seg = janelas(new Date("2026-11-09T12:00:00Z"));
    expect(seg.inicioSemana.toISOString()).toBe("2026-11-09T03:00:00.000Z");
  });

  it("mês corrente em SP, inclusive na virada do ano", () => {
    const j = janelas(AGORA);
    expect(j.inicioMes.toISOString()).toBe("2026-11-01T03:00:00.000Z");
    expect(j.fimMes.toISOString()).toBe("2026-12-01T03:00:00.000Z");
    const dez = janelas(new Date("2027-01-01T01:00:00Z")); // ainda 31/12 em SP
    expect(dez.inicioMes.toISOString()).toBe("2026-12-01T03:00:00.000Z");
    expect(dez.fimMes.toISOString()).toBe("2027-01-01T03:00:00.000Z");
  });
});

describe("conversões", () => {
  it("paraNumero aceita Decimal, string e número", () => {
    expect(paraNumero({ toNumber: () => 12.5 })).toBe(12.5);
    expect(paraNumero("10.25")).toBe(10.25);
    expect(paraNumero(3)).toBe(3);
    expect(paraNumero(null)).toBe(0);
    expect(paraNumero("abc")).toBe(0);
  });

  it("seguidoresDasMetricas lê chaves comuns e ignora lixo", () => {
    expect(seguidoresDasMetricas({ seguidores: 120 })).toBe(120);
    expect(seguidoresDasMetricas({ followers: "45" })).toBe(45);
    expect(seguidoresDasMetricas({ outra: 1 })).toBeNull();
    expect(seguidoresDasMetricas(null)).toBeNull();
    expect(seguidoresDasMetricas([1, 2])).toBeNull();
  });
});

describe("bloco", () => {
  it("tabela inexistente vira sem_tabela; outro erro vira erro", async () => {
    expect(await bloco(() => Promise.reject(p2021()))).toEqual({ ok: false, motivo: "sem_tabela" });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await bloco(() => Promise.reject(new Error("timeout")))).toEqual({ ok: false, motivo: "erro" });
    spy.mockRestore();
  });
});

describe("carregarVisaoGeral", () => {
  it("lê RedeSnapshot por rede e cai no FollowerSnapshot do IG quando falta o Instagram", async () => {
    const db = fakeDb({
      redes: [{ rede: "youtube", estado: "ok", metricas: { inscritos: 300 }, coletadoEm: AGORA }],
      contasIg: [{ username: "opi", followerSnapshots: [{ followersCount: 1500, date: AGORA }] }],
    });
    const v = await carregarVisaoGeral(db, "ws1", AGORA);
    expect(v.redes).toEqual({
      ok: true,
      dados: [
        { rede: "youtube", seguidores: 300, estado: "ok", coletadoEm: AGORA, fonte: "rede" },
        { rede: "instagram", seguidores: 1500, estado: "ok", coletadoEm: AGORA, fonte: "instagram" },
      ],
    });
    expect(db.redeSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { workspaceId: "ws1" }, distinct: ["rede"] }),
    );
  });

  it("não consulta o IG antigo quando RedeSnapshot já tem o Instagram", async () => {
    const db = fakeDb({ redes: [{ rede: "instagram", estado: "ok", metricas: { seguidores: 10 }, coletadoEm: AGORA }] });
    await carregarVisaoGeral(db, "ws1", AGORA);
    expect(db.instagramAccount.findMany).not.toHaveBeenCalled();
  });

  it("sem tabela RedeSnapshot ainda mostra o IG pelo FollowerSnapshot", async () => {
    const db = fakeDb({
      redes: p2021(),
      contasIg: [{ username: "opi", followerSnapshots: [{ followersCount: 7, date: AGORA }] }],
    });
    const v = await carregarVisaoGeral(db, "ws1", AGORA);
    expect(v.redes.ok && v.redes.dados[0].seguidores).toBe(7);
  });

  it("sem tabela e sem IG o bloco de redes diz sem_tabela, e o resto continua", async () => {
    const db = fakeDb({ redes: p2021(), postsSemana: p2021(), dmCounts: [2, 9, 1] });
    const v = await carregarVisaoGeral(db, "ws1", AGORA);
    expect(v.redes).toEqual({ ok: false, motivo: "sem_tabela" });
    expect(v.posts).toEqual({ ok: false, motivo: "sem_tabela" });
    expect(v.dms).toEqual({ ok: true, dados: { hoje: 2, seteDias: 9, emRevisao: 1 } });
  });

  it("conta posts da semana por status e legendas futuras sem o aviso", async () => {
    const db = fakeDb({
      postsSemana: [
        { status: "PUBLICADO" },
        { status: "PUBLICADO" },
        { status: "APROVADO" },
        { status: "PUBLICANDO" },
        { status: "RASCUNHO" },
        { status: "ERRO" },
      ],
      postsFuturos: [{ legenda: `Texto.\n\n${AVISO_OBRIGATORIO}` }, { legenda: "Sem aviso nenhum" }],
    });
    const v = await carregarVisaoGeral(db, "ws1", AGORA);
    expect(v.posts).toEqual({ ok: true, dados: { publicados: 2, agendados: 2, rascunhos: 1, erros: 1, semAviso: 1 } });
  });

  it("DMs contam só SENT com dmSentAt na janela, sempre por workspace", async () => {
    const db = fakeDb({ dmCounts: [3, 20, 0] });
    await carregarVisaoGeral(db, "ws1", AGORA);
    const j = janelas(AGORA);
    expect(db.dmLog.count).toHaveBeenNthCalledWith(1, {
      where: { workspaceId: "ws1", status: "SENT", dmSentAt: { gte: j.inicioHoje } },
    });
    expect(db.dmLog.count).toHaveBeenNthCalledWith(2, {
      where: { workspaceId: "ws1", status: "SENT", dmSentAt: { gte: j.inicio7Dias } },
    });
  });

  it("soma o caixa do mês com Decimal separando pago e previsto", async () => {
    const dec = (n: number) => ({ toNumber: () => n });
    const db = fakeDb({
      lancamentos: [
        { tipo: "DESPESA", status: "PAGO", valor: dec(10.1) },
        { tipo: "DESPESA", status: "PAGO", valor: dec(0.2) },
        { tipo: "DESPESA", status: "PREVISTO", valor: dec(99.9) },
        { tipo: "RECEITA", status: "PAGO", valor: dec(500) },
      ],
      vencidos: 2,
    });
    const v = await carregarVisaoGeral(db, "ws1", AGORA);
    expect(v.caixa).toEqual({
      ok: true,
      dados: {
        despesasPagas: 10.3,
        despesasPrevistas: 99.9,
        receitasPagas: 500,
        receitasPrevistas: 0,
        lancamentosNoMes: 4,
        vencidos: 2,
      },
    });
  });

  it("campanhas pausadas e freio puxado", async () => {
    const db = fakeDb({ pausadas: [{ id: "a1", name: "TERMOS" }], totalPausadas: 1, freio: "opi.freio.pausar" });
    const v = await carregarVisaoGeral(db, "ws1", AGORA);
    expect(v.campanhas).toEqual({
      ok: true,
      dados: { pausadas: [{ id: "a1", name: "TERMOS" }], totalPausadas: 1, freioPuxado: true },
    });
  });

  it("pedidos aos agentes em aberto com mensagem truncada", async () => {
    const db = fakeDb({
      pedidos: [{ id: "p1", agente: "editor", mensagem: "x".repeat(200), status: "NOVO", createdAt: AGORA }],
      pedidosTotal: 3,
      pedidosErro: 1,
    });
    const v = await carregarVisaoGeral(db, "ws1", AGORA);
    expect(v.agentes.ok).toBe(true);
    if (!v.agentes.ok) return;
    expect(v.agentes.dados.totalEmAndamento).toBe(3);
    expect(v.agentes.dados.errosRecentes).toBe(1);
    expect(v.agentes.dados.emAndamento[0].mensagem.length).toBeLessThanOrEqual(90);
  });
});

describe("montarPendencias", () => {
  const vazio = (): Pick<VisaoGeral, "redes" | "posts" | "dms" | "campanhas" | "caixa" | "agentes"> => ({
    redes: { ok: true, dados: [] },
    posts: { ok: true, dados: { publicados: 0, agendados: 0, rascunhos: 0, erros: 0, semAviso: 0 } },
    dms: { ok: true, dados: { hoje: 0, seteDias: 0, emRevisao: 0 } },
    campanhas: { ok: true, dados: { pausadas: [], totalPausadas: 0, freioPuxado: false } },
    caixa: {
      ok: true,
      dados: { despesasPagas: 0, despesasPrevistas: 0, receitasPagas: 0, receitasPrevistas: 0, lancamentosNoMes: 0, vencidos: 0 },
    },
    agentes: { ok: true, dados: { emAndamento: [], totalEmAndamento: 0, errosRecentes: 0 } },
  });

  it("lista vazia quando está tudo em dia", () => {
    expect(montarPendencias(vazio())).toEqual([]);
  });

  it("blocos indisponíveis não geram pendência", () => {
    const v = vazio();
    v.posts = { ok: false, motivo: "sem_tabela" };
    v.caixa = { ok: false, motivo: "erro" };
    expect(montarPendencias(v)).toEqual([]);
  });

  it("cada regra aponta para a página certa, erros primeiro", () => {
    const v = vazio();
    v.redes = { ok: true, dados: [{ rede: "tiktok", seguidores: null, estado: "desconectado", coletadoEm: AGORA, fonte: "rede" }] };
    v.posts = { ok: true, dados: { publicados: 0, agendados: 0, rascunhos: 2, erros: 1, semAviso: 1 } };
    v.dms = { ok: true, dados: { hoje: 0, seteDias: 0, emRevisao: 3 } };
    v.campanhas = { ok: true, dados: { pausadas: [], totalPausadas: 2, freioPuxado: true } };
    v.caixa = {
      ok: true,
      dados: { despesasPagas: 0, despesasPrevistas: 0, receitasPagas: 0, receitasPrevistas: 0, lancamentosNoMes: 0, vencidos: 1 },
    };
    v.agentes = { ok: true, dados: { emAndamento: [], totalEmAndamento: 0, errosRecentes: 1 } };

    const p = montarPendencias(v);
    expect(p.map((x) => [x.nivel, x.href])).toEqual([
      ["erro", LINKS.campanhas], // freio
      ["erro", LINKS.registroDms], // DMs em revisão
      ["erro", LINKS.calendario], // post com erro
      ["erro", LINKS.calendario], // legenda sem aviso
      ["erro", LINKS.agentes],
      ["erro", LINKS.redes],
      ["normal", LINKS.campanhas], // pausadas
      ["normal", LINKS.calendario], // rascunhos
      ["normal", LINKS.financeiro], // vencidos
    ]);
    expect(p[1].texto).toBe("3 DMs seguradas para revisão");
    expect(p[6].texto).toBe("2 campanhas pausadas aguardando revisão");
    expect(p[3].texto).toBe("1 legenda sem o aviso obrigatório");
  });

  it("rede ok não vira pendência", () => {
    const v = vazio();
    v.redes = { ok: true, dados: [{ rede: "instagram", seguidores: 10, estado: "ok", coletadoEm: AGORA, fonte: "instagram" }] };
    expect(montarPendencias(v)).toEqual([]);
  });
});
