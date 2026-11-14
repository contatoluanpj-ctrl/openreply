import { describe, expect, it } from "vitest";
import {
  contagemPublicados,
  descreverDestinos,
  erroLegivel,
  podeTentarDeNovo,
  precisaAprovar,
  rotuloDestino,
} from "@/components/opi/calendario/destinos-texto";
import { rotuloUltimoPost } from "@/components/opi/redes/ultimo-post";

const d = (rede: string, status: string, aprovadoEm: string | null = null) =>
  ({ rede, nome: rede, status, aprovadoEm }) as Parameters<typeof descreverDestinos>[0][number];

describe("textos dos destinos no Calendário", () => {
  it("LinkedIn e X pendentes sem aprovação pedem Aprovar; Instagram nunca", () => {
    expect(precisaAprovar(d("linkedin", "PENDENTE"))).toBe(true);
    expect(precisaAprovar(d("x", "ERRO"))).toBe(true);
    expect(precisaAprovar(d("linkedin", "PENDENTE", "2026-11-14T21:00:00.000Z"))).toBe(false);
    expect(precisaAprovar(d("linkedin", "PUBLICADO"))).toBe(false);
    expect(precisaAprovar(d("x", "PUBLICANDO"))).toBe(false);
    expect(precisaAprovar(d("x", "PULADO"))).toBe(false);
    expect(precisaAprovar(d("instagram", "PENDENTE"))).toBe(false);
  });

  it("o selo escreve o status, e Aguardando aprovação no destino pendente sem aprovação", () => {
    expect(rotuloDestino(d("instagram", "PENDENTE"))).toBe("Pendente");
    expect(rotuloDestino(d("x", "PENDENTE"))).toBe("Aguardando aprovação");
    expect(rotuloDestino(d("x", "PENDENTE", "2026-11-14T21:00:00.000Z"))).toBe("Pendente");
    expect(rotuloDestino(d("youtube", "PUBLICADO"))).toBe("Publicado");
    expect(rotuloDestino(d("facebook", "ERRO"))).toBe("Erro");
    expect(rotuloDestino(d("facebook", "PULADO"))).toBe("Pulado");
  });

  it("Tentar de novo só aparece no destino em ERRO", () => {
    expect(podeTentarDeNovo({ status: "ERRO" })).toBe(true);
    expect(podeTentarDeNovo({ status: "PULADO" })).toBe(false);
    expect(podeTentarDeNovo({ status: "PUBLICADO" })).toBe(false);
  });

  it("descreve e conta os destinos", () => {
    const lista = [
      { ...d("instagram", "PUBLICADO"), nome: "Instagram" },
      { ...d("youtube", "ERRO"), nome: "YouTube" },
    ];
    expect(descreverDestinos(lista)).toBe("Instagram: Publicado; YouTube: Erro");
    expect(contagemPublicados(lista)).toBe("1/2");
    expect(contagemPublicados([])).toBeNull();
  });

  it("erro em JSON bruto vira só a mensagem", () => {
    expect(erroLegivel('Graph 400: {"error":{"message":"Media ID is not available","code":9007}}')).toBe(
      "Graph 400: Media ID is not available",
    );
    expect(erroLegivel('{"message":"Token expirado"}')).toBe("Token expirado");
  });

  it("erro vazio, com quebras de linha ou longo continua legível", () => {
    expect(erroLegivel(null)).toBe("A rede não informou o motivo da falha.");
    expect(erroLegivel("  falha\n  de   rede ")).toBe("falha de rede");
    expect(erroLegivel("chave {sem fechar")).toBe("chave {sem fechar");
    const longo = erroLegivel("a".repeat(500));
    expect(longo.length).toBe(220);
    expect(longo.endsWith("…")).toBe(true);
  });
});

describe("Último post no card da rede", () => {
  it("mostra dd/mm às hh:mm no horário de Brasília", () => {
    expect(rotuloUltimoPost("2026-11-14T21:00:00.000Z")).toBe("14/11 às 18:00");
    expect(rotuloUltimoPost("2026-11-15T02:30:00.000Z")).toBe("14/11 às 23:30");
    expect(rotuloUltimoPost("2026-11-15T03:00:00.000Z")).toBe("15/11 às 00:00");
  });

  it("data inválida não quebra o card", () => {
    expect(rotuloUltimoPost("não é data")).toBe("data não informada");
  });
});
