import { describe, expect, it, vi } from "vitest";
import { C_LEVELS, OPERACIONAIS } from "@/lib/opi/agentes";
import { montarGrade } from "@/lib/opi/agentes-dados";
import {
  carregarDepartamento,
  montarPendenciasDoDepartamento,
  pendenciaDePedidosComErro,
  type DbDepartamento,
} from "@/lib/opi/departamento-dados";
import {
  DEPARTAMENTOS,
  agentesDoDepartamento,
  departamentoPorSlug,
  pendenciasDoDepartamento,
  pessoasDoDepartamento,
} from "@/lib/opi/departamentos";
import { lerTema } from "@/lib/opi/tema";

const AGORA = new Date("2026-11-14T15:00:00.000Z");
const dep = (slug: string) => departamentoPorSlug(slug)!;

describe("pessoasDoDepartamento", () => {
  it("Marketing: CMO e quem reporta a ele", () => {
    const p = pessoasDoDepartamento(dep("marketing"));
    expect(p.diretor?.id).toBe("cmo");
    expect(p.equipe.map((m) => m.id)).toEqual(OPERACIONAIS.filter((o) => o.reportaA === "cmo").map((o) => o.id));
    expect(p.equipe.length).toBeGreaterThan(0);
    expect(p.apoio).toEqual([]);
  });

  it("Dados: o CEO é o diretor e o analista de dados é a equipe (como no registro)", () => {
    const p = pessoasDoDepartamento(dep("dados"));
    expect(p.diretor?.id).toBe("ceo");
    expect(p.equipe.map((m) => m.id)).toEqual(["data_analyst"]);
  });

  it("Segurança: CTO como diretor, Compliance de apoio e nenhuma equipe emprestada da Tecnologia", () => {
    const p = pessoasDoDepartamento(dep("seguranca"));
    expect(p.diretor?.id).toBe("cto");
    expect(p.apoio.map((m) => m.id)).toEqual(["compliance"]);
    expect(p.equipe).toEqual([]);
    expect(pessoasDoDepartamento(dep("tecnologia")).equipe.map((m) => m.id)).toContain("software_engineer");
  });

  it("todo departamento tem diretor do catálogo e a equipe só tem gente do catálogo", () => {
    const ids = new Set([...C_LEVELS, ...OPERACIONAIS].map((m) => m.id));
    for (const d of DEPARTAMENTOS) {
      const p = pessoasDoDepartamento(d);
      expect(p.diretor, d.slug).toBeDefined();
      for (const m of [...p.equipe, ...p.apoio]) expect(ids.has(m.id), `${d.slug}: ${m.id}`).toBe(true);
    }
  });

  it("agentesDoDepartamento junta diretor e equipe, sem o apoio", () => {
    expect(agentesDoDepartamento(dep("juridico"))).toEqual(["compliance", "options_education_reviewer"]);
    expect(agentesDoDepartamento(dep("seguranca"))).toEqual(["cto"]);
  });
});

describe("pendências do departamento", () => {
  const gerais = [
    { texto: "2 rascunhos no calendário aguardando sua aprovação", href: "/dashboard/calendario", nivel: "normal" as const },
    { texto: "1 DM falhou no envio", href: "/logs", nivel: "erro" as const },
    { texto: "1 erro registrado no sistema", href: "/diagnostics", nivel: "erro" as const },
    { texto: "3 DMs seguradas para revisão", href: "/dashboard/palavras", nivel: "normal" as const },
  ];

  it("cada pendência aparece só no departamento dono da tela que resolve", () => {
    expect(pendenciasDoDepartamento(dep("marketing"), gerais).map((i) => i.href)).toEqual(["/dashboard/calendario", "/dashboard/palavras"]);
    expect(pendenciasDoDepartamento(dep("atendimentos"), gerais).map((i) => i.href)).toEqual(["/logs"]);
    expect(pendenciasDoDepartamento(dep("tecnologia"), gerais).map((i) => i.href)).toEqual(["/diagnostics"]);
    expect(pendenciasDoDepartamento(dep("produto"), gerais)).toEqual([]);
  });

  it("pedido com erro vira uma linha só, com link para Agentes; zero não gera linha", () => {
    expect(pendenciaDePedidosComErro(0)).toEqual([]);
    expect(pendenciaDePedidosComErro(1)).toEqual([
      { texto: "1 pedido da equipe terminou com erro nos últimos 7 dias", href: "/dashboard/agentes", nivel: "erro" },
    ]);
    expect(pendenciaDePedidosComErro(3)[0].texto).toBe("3 pedidos da equipe terminaram com erro nos últimos 7 dias");
  });

  it("erro vem antes do que só espera aprovação", () => {
    const itens = montarPendenciasDoDepartamento(dep("marketing"), { pedidosComErro: 2, gerais });
    expect(itens.map((i) => i.nivel)).toEqual(["erro", "normal", "normal"]);
    expect(itens[0].href).toBe("/dashboard/agentes");
  });
});

function bancoFalso(over: Partial<Record<string, unknown>> = {}) {
  const pedidoFindMany = vi.fn().mockResolvedValue([
    { id: "p1", agente: "cmo", status: "EM_ANDAMENTO", createdAt: new Date("2026-11-14T12:00:00Z") },
    { id: "p2", agente: "editor-de-videos", status: "NOVO", createdAt: new Date("2026-11-14T13:00:00Z") },
  ]);
  const db = {
    pedidoAgente: { findMany: pedidoFindMany, count: vi.fn().mockResolvedValue(1) },
    postAgendado: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(2) },
    automation: { findMany: vi.fn().mockResolvedValue([]) },
    dmLog: { count: vi.fn().mockResolvedValue(0) },
    operationalEvent: { groupBy: vi.fn().mockResolvedValue([]) },
    ...over,
  };
  return { db: db as unknown as DbDepartamento, bruto: db, pedidoFindMany };
}

describe("carregarDepartamento", () => {
  it("lista os pedidos em aberto da equipe sem buscar o texto do pedido", async () => {
    const { db, pedidoFindMany } = bancoFalso();
    const r = await carregarDepartamento(db, "ws1", dep("marketing"), AGORA);

    expect(r.pedidos).toEqual({
      ok: true,
      dados: [
        { id: "p1", agente: "cmo", status: "EM_ANDAMENTO", createdAt: new Date("2026-11-14T12:00:00Z") },
        { id: "p2", agente: "editor-de-videos", status: "NOVO", createdAt: new Date("2026-11-14T13:00:00Z") },
      ],
    });
    const arg = pedidoFindMany.mock.calls[0][0];
    expect(arg.where.workspaceId).toBe("ws1");
    expect(arg.where.status).toEqual({ in: ["NOVO", "EM_ANDAMENTO"] });
    expect(arg.where.agente.in).toContain("cmo");
    expect(arg.where.agente.in).toContain("editor-de-videos");
    expect(arg.where.agente.in).not.toContain("cto");
    // Sem nome nem telefone de lead: nem a mensagem nem a resposta do pedido entram na consulta.
    expect(Object.keys(arg.select).sort()).toEqual(["agente", "createdAt", "id", "status"]);
  });

  it("junta o pedido com erro e os rascunhos que esperam aprovação no Marketing", async () => {
    const { db } = bancoFalso();
    const r = await carregarDepartamento(db, "ws1", dep("marketing"), AGORA);
    expect(r.pendencias.ok).toBe(true);
    if (!r.pendencias.ok) return;
    expect(r.pendencias.dados.map((i) => i.href)).toEqual(["/dashboard/agentes", "/dashboard/calendario"]);
    expect(r.pendencias.dados[1].texto).toBe("2 rascunhos no calendário aguardando sua aprovação");
  });

  it("departamento sem tela não consulta posts nem DMs e não inventa pendência", async () => {
    const { db, bruto } = bancoFalso({ pedidoAgente: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) } });
    const r = await carregarDepartamento(db, "ws1", dep("pesquisa"), AGORA);
    expect(r).toEqual({ pedidos: { ok: true, dados: [] }, pendencias: { ok: true, dados: [] } });
    expect(bruto.postAgendado.count).not.toHaveBeenCalled();
    expect(bruto.dmLog.count).not.toHaveBeenCalled();
  });

  it("se a consulta de pedidos falha, o bloco fica indisponível e o resto aparece", async () => {
    const silencio = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = bancoFalso({
      pedidoAgente: { findMany: vi.fn().mockRejectedValue(new Error("caiu")), count: vi.fn().mockResolvedValue(0) },
    });
    const r = await carregarDepartamento(db, "ws1", dep("marketing"), AGORA);
    expect(r.pedidos).toEqual({ ok: false, motivo: "erro" });
    expect(r.pendencias.ok).toBe(true);
    silencio.mockRestore();
  });
});

describe("grade da tela Agentes", () => {
  it("12 diretores na ordem do registro: cabem em 4 colunas por 3 linhas", () => {
    const grade = montarGrade(C_LEVELS, OPERACIONAIS);
    expect(grade).toHaveLength(12);
    expect(grade.map((g) => g.chefe.id)).toEqual(C_LEVELS.map((c) => c.id));
  });

  it("cada operacional aparece na equipe de um único diretor", () => {
    const grade = montarGrade(C_LEVELS, OPERACIONAIS);
    const todos = grade.flatMap((g) => g.equipe.map((m) => m.id));
    expect(todos.sort()).toEqual(OPERACIONAIS.map((o) => o.id).sort());
    expect(grade.find((g) => g.chefe.id === "chro")?.equipe).toEqual([]);
  });
});

describe("variante do tema", () => {
  it("A é o padrão; só o valor b troca", () => {
    expect(lerTema(undefined)).toBe("a");
    expect(lerTema("a")).toBe("a");
    expect(lerTema("b")).toBe("b");
    expect(lerTema("qualquer")).toBe("a");
  });
});
