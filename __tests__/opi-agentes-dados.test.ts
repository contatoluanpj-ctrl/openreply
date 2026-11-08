import { describe, expect, it } from "vitest";
import { AGENTES_IDS, C_LEVELS, OPERACIONAIS, isAgenteId, nomeDoAgente, type MembroEquipe } from "../lib/opi/agentes";
import { estadoDoMembro, historicoRecente, iniciais, montarOrganograma, resumirPedidos } from "../lib/opi/agentes-dados";

const m = (id: string, extra: Partial<MembroEquipe> = {}): MembroEquipe => ({ id, nome: id.toUpperCase(), papel: "x", ...extra });

describe("estadoDoMembro", () => {
  it("ACTIVE → ativo, ON-DEMAND → sob demanda, FUTURE e não justificado → futuro", () => {
    expect(estadoDoMembro(m("a", { status: "ACTIVE" }))).toBe("ativo");
    expect(estadoDoMembro(m("b", { status: "ON-DEMAND" }))).toBe("sob-demanda");
    expect(estadoDoMembro(m("c", { status: "FUTURE" }))).toBe("futuro");
    expect(estadoDoMembro(m("d", { status: "NOT_JUSTIFIED_YET" }))).toBe("futuro");
    expect(estadoDoMembro(m("luan"))).toBe("ativo");
  });
});

describe("iniciais", () => {
  it.each([
    ["Editor de vídeos", "EV"],
    ["CEO", "CEO"],
    ["CX", "CX"],
    ["Social/Distribuição", "SD"],
    ["Data & Scorecard Analyst", "DS"],
    ["Lead Response (SDR)", "LR"],
    ["Luan", "LU"],
    ["", "?"],
  ])("%s → %s", (nome, esperado) => expect(iniciais(nome)).toBe(esperado));
});

describe("montarOrganograma", () => {
  it("põe os C-levels com equipe no meio e divide os demais nos lados, na ordem do registro", () => {
    const c = [m("a"), m("b"), m("c"), m("d"), m("e")];
    const o = [m("x", { reportaA: "c" }), m("y", { reportaA: "c" }), m("z", { reportaA: "e" })];
    const { colunas, semChefe } = montarOrganograma(c, o);
    expect(colunas.map((col) => col.chefe.id)).toEqual(["a", "c", "e", "b", "d"]);
    expect(colunas[1].equipe.map((e) => e.id)).toEqual(["x", "y"]);
    expect(colunas[0].equipe).toEqual([]);
    expect(semChefe).toEqual([]);
  });

  it("lista quem reporta a um chefe que não existe", () => {
    const { semChefe } = montarOrganograma([m("a")], [m("x", { reportaA: "zz" }), m("y")]);
    expect(semChefe.map((s) => s.id)).toEqual(["x", "y"]);
  });

  it("com o registro real: todo C-level aparece uma vez e todo operacional cai sob seu chefe", () => {
    const { colunas, semChefe } = montarOrganograma(C_LEVELS, OPERACIONAIS);
    expect(colunas).toHaveLength(C_LEVELS.length);
    expect(new Set(colunas.map((col) => col.chefe.id)).size).toBe(C_LEVELS.length);
    expect(colunas.flatMap((col) => col.equipe).length).toBe(OPERACIONAIS.length);
    expect(semChefe).toEqual([]);
    expect(colunas.find((col) => col.chefe.id === "cmo")?.equipe.map((e) => e.id)).toContain("editor-de-videos");
  });
});

describe("resumirPedidos", () => {
  const agora = new Date("2026-11-08T12:00:00Z");
  it("um resumo por id, com ativo, último e abertos; ignora ids fora da lista", () => {
    const pedidos = [
      { agente: "cmo", status: "FEITO", updatedAt: new Date("2026-11-07T10:00:00Z") },
      { agente: "cmo", status: "NOVO", updatedAt: new Date("2026-11-08T08:00:00Z") },
      { agente: "ceo", status: "EM_ANDAMENTO", updatedAt: new Date("2026-11-01T08:00:00Z") },
      { agente: "fantasma", status: "NOVO", updatedAt: agora },
    ];
    const r = resumirPedidos(["ceo", "cmo", "cfo"], pedidos, agora);
    expect(r.map((x) => x.agente)).toEqual(["ceo", "cmo", "cfo"]);
    expect(r[0]).toMatchObject({ ativo: true, abertos: 1 });
    expect(r[1]).toEqual({ agente: "cmo", ativo: false, ultimo: "2026-11-08T08:00:00.000Z", abertos: 1 });
    expect(r[2]).toEqual({ agente: "cfo", ativo: false, ultimo: null, abertos: 0 });
  });

  it("atividade nos últimos 15 minutos conta como trabalhando", () => {
    const r = resumirPedidos(["cto"], [{ agente: "cto", status: "FEITO", updatedAt: new Date(agora.getTime() - 60_000) }], agora);
    expect(r[0].ativo).toBe(true);
  });
});

describe("historicoRecente", () => {
  it("mais recente primeiro e corta no limite", () => {
    const itens = [1, 2, 3, 4].map((d) => ({ id: `p${d}`, createdAt: `2026-11-0${d}T00:00:00Z` }));
    expect(historicoRecente(itens, 3).map((i) => i.id)).toEqual(["p4", "p3", "p2"]);
    expect(itens[0].id).toBe("p1");
  });
});

describe("ids aceitos pelo envio", () => {
  it("todos os C-levels e operacionais, nunca o fundador", () => {
    expect(AGENTES_IDS).toHaveLength(C_LEVELS.length + OPERACIONAIS.length);
    expect(isAgenteId("cfo")).toBe(true);
    expect(isAgenteId("editor-de-videos")).toBe(true);
    expect(isAgenteId("luan")).toBe(false);
    expect(isAgenteId(42)).toBe(false);
    expect(nomeDoAgente("chief_ai")).toBe("CIO");
    expect(nomeDoAgente("luan")).toBe("Luan");
  });
});
