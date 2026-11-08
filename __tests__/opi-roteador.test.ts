import { describe, expect, it, vi } from "vitest";
import { AGENTES_IDS } from "@/lib/opi/agentes";
import { ROTAS, corpoRoteador, interpretarResposta, mensagemParaAgente, sugerirRota } from "@/lib/opi/roteador";

function resposta(choice: string, probs: Record<string, number>, confidence: number, varias = 0.1) {
  return {
    answers: {
      responsavel: { type: "choice", choice, confidence, probabilities: probs },
      varias_areas: { type: "noul", noul: varias },
    },
  };
}

describe("roteador do chat central", () => {
  it("tem descrição de rota para todo agente do mapa", () => {
    for (const id of AGENTES_IDS) expect(ROTAS[id], id).toBeTruthy();
    const crit = corpoRoteador("x").questions.responsavel.criteria;
    expect(Object.keys(crit).sort()).toEqual([...AGENTES_IDS].sort());
  });

  it("manda ao responsável quando o Jev está confiante", () => {
    const r = interpretarResposta(resposta("editor-de-videos", { "editor-de-videos": 0.97, cmo: 0.03 }, 0.95));
    expect(r?.destinos).toEqual(["editor-de-videos"]);
    expect(r?.ranking[0].id).toBe("editor-de-videos");
  });

  it("em dúvida, vai ao CEO", () => {
    const r = interpretarResposta(resposta("compliance", { compliance: 0.36, cmo: 0.33, cto: 0.31 }, 0.2));
    expect(r?.destinos).toEqual(["ceo"]);
  });

  it("projeto de várias áreas: responsável + CEO", () => {
    const r = interpretarResposta(resposta("cpo", { cpo: 0.86, cto: 0.14 }, 0.8, 0.75));
    expect(r?.destinos).toEqual(["cpo", "ceo"]);
  });

  it("resposta inválida vira null (o Luan escolhe à mão)", () => {
    expect(interpretarResposta(null)).toBeNull();
    expect(interpretarResposta(resposta("desconhecido", {}, 1))).toBeNull();
  });

  it("falha de rede devolve null sem lançar", async () => {
    const f = vi.fn().mockRejectedValue(new Error("rede"));
    await expect(sugerirRota("oi", "k", f)).resolves.toBeNull();
  });

  it("avisa o agente sobre os outros destinos", () => {
    expect(mensagemParaAgente("faz X", "cpo", ["cpo", "ceo"])).toContain("CEO");
    expect(mensagemParaAgente("faz X", "cpo", ["cpo"])).not.toContain("também enviado");
  });
});
