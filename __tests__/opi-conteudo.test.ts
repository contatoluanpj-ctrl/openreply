import { describe, expect, it } from "vitest";
import {
  indiceGeral,
  indicePorMil,
  inicioLegenda,
  linhasConteudo,
  melhorEPior,
  ordenarConteudo,
  type PostBruto,
} from "@/lib/opi/conteudo";

const post = (id: string, x: Partial<PostBruto> = {}): PostBruto => ({
  id,
  caption: `Legenda ${id}`,
  permalink: `https://instagram.com/reel/${id}`,
  mediaType: "REELS",
  timestamp: "2026-11-01T21:00:00+0000",
  views: 1000,
  reach: 800,
  likes: 10,
  comments: 2,
  saved: 10,
  shares: 5,
  ...x,
});

describe("indicePorMil", () => {
  it("(salvamentos + compartilhamentos) ÷ visualizações × 1.000, com 1 casa", () => {
    expect(indicePorMil(10, 5, 1000)).toBe(15);
    expect(indicePorMil(7, 0, 3000)).toBe(2.3);
    expect(indicePorMil(0, 0, 500)).toBe(0);
  });
  it("sem visualizações ou sem as duas métricas não há índice", () => {
    expect(indicePorMil(10, 5, null)).toBeNull();
    expect(indicePorMil(10, 5, 0)).toBeNull();
    expect(indicePorMil(null, null, 1000)).toBeNull();
    expect(indicePorMil(null, 4, 1000)).toBe(4);
  });
});

describe("melhorEPior", () => {
  it("destaca o maior e o menor índice entre os posts com visualizações suficientes", () => {
    const linhas = linhasConteudo([
      post("a", { saved: 10, shares: 5 }), // 15
      post("b", { saved: 40, shares: 10 }), // 50
      post("c", { saved: 1, shares: 0 }), // 1
      post("ruido", { views: 20, saved: 5, shares: 5 }), // 500 por mil, mas só 20 views
      post("foto", { views: null }),
    ]);
    expect(melhorEPior(linhas)).toEqual({ melhorId: "b", piorId: "c" });
    expect(linhas.find((l) => l.id === "ruido")).toMatchObject({ indice: 500, comparavel: false });
    expect(linhas.find((l) => l.id === "foto")).toMatchObject({ indice: null, comparavel: false });
  });
  it("com um post só há melhor; sem nenhum, nada", () => {
    expect(melhorEPior(linhasConteudo([post("a")]))).toEqual({ melhorId: "a", piorId: null });
    expect(melhorEPior(linhasConteudo([post("a", { views: null })]))).toEqual({ melhorId: null, piorId: null });
    expect(melhorEPior([])).toEqual({ melhorId: null, piorId: null });
  });
});

describe("ordenarConteudo", () => {
  const linhas = linhasConteudo([
    post("a", { timestamp: "2026-11-01T21:00:00+0000", views: 300 }),
    post("b", { timestamp: "2026-11-03T21:00:00+0000", views: null }),
    post("c", { timestamp: "2026-11-02T21:00:00+0000", views: 900 }),
  ]);
  it("ordena por data e por número, nas duas direções, sem mexer na lista original", () => {
    expect(ordenarConteudo(linhas, "timestamp", "desc").map((l) => l.id)).toEqual(["b", "c", "a"]);
    expect(ordenarConteudo(linhas, "timestamp", "asc").map((l) => l.id)).toEqual(["a", "c", "b"]);
    expect(ordenarConteudo(linhas, "views", "desc").map((l) => l.id)).toEqual(["c", "a", "b"]);
    expect(linhas.map((l) => l.id)).toEqual(["a", "b", "c"]);
  });
  it("post sem o número fica sempre no fim", () => {
    expect(ordenarConteudo(linhas, "views", "asc").map((l) => l.id)).toEqual(["a", "c", "b"]);
    expect(ordenarConteudo(linhas, "indice", "desc").at(-1)?.id).toBe("b");
  });
});

describe("inicioLegenda e indiceGeral", () => {
  it("legenda em uma linha, cortada com reticências", () => {
    expect(inicioLegenda("Primeira linha\n\nsegunda")).toBe("Primeira linha segunda");
    expect(inicioLegenda(null)).toBe("Sem legenda");
    expect(inicioLegenda("x".repeat(100), 20)).toHaveLength(20);
  });
  it("índice geral soma os posts que têm visualização", () => {
    const linhas = linhasConteudo([post("a", { views: 1000, saved: 10, shares: 0 }), post("b", { views: 3000, saved: 20, shares: 10 }), post("c", { views: null })]);
    expect(indiceGeral(linhas)).toBe(10);
    expect(indiceGeral([])).toBeNull();
  });
});
