import { describe, it, expect } from "vitest";
import {
  areaDaPendencia,
  cardsPlataforma,
  chaveDiaSP,
  conversaoPorPalavra,
  distribuicaoAudiencia,
  dmsPorDia,
  horaSP,
  horarioComentarios,
  horasDePico,
  rotuloStat,
  inicioJanela,
  serieSeguidores,
  taxaConversao,
  totalSeguidores,
  ultimoEAnterior,
  ultimosDias,
  variacaoPct,
  type LogDm,
  type SnapRede,
} from "../lib/opi/dashboard-dados";

// 08/11/2026 15:00 em São Paulo = 18:00 UTC.
const AGORA = new Date("2026-11-08T18:00:00Z");

const log = (createdAt: string, status: string, palavra: string | null = "JUROS", campanha = "Reel JUROS"): LogDm => ({
  createdAt: new Date(createdAt),
  dmSentAt: status === "SENT" ? new Date(createdAt) : null,
  status,
  matchedKeyword: palavra,
  campanha,
});

describe("tempo em São Paulo", () => {
  it("usa o dia e a hora de SP (UTC-3)", () => {
    // 02:00 UTC do dia 9 ainda é 23h do dia 8 em SP.
    expect(chaveDiaSP(new Date("2026-11-09T02:00:00Z"))).toBe("2026-11-08");
    expect(horaSP(new Date("2026-11-09T02:00:00Z"))).toBe(23);
  });

  it("lista os últimos n dias terminando hoje", () => {
    expect(ultimosDias(AGORA, 3)).toEqual(["2026-11-06", "2026-11-07", "2026-11-08"]);
  });

  it("janela começa à meia-noite de SP", () => {
    expect(inicioJanela(AGORA, 7).toISOString()).toBe("2026-11-02T03:00:00.000Z");
  });

  it("variação sem base comparável não vira número", () => {
    expect(variacaoPct(110, 100)).toBe(10);
    expect(variacaoPct(5, 0)).toBeNull();
    expect(variacaoPct(5, null)).toBeNull();
  });
});

describe("serieSeguidores", () => {
  const dias = ["2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"];

  it("soma as contas e repete o último valor em dia sem coleta", () => {
    const s = serieSeguidores(
      [
        { instagramAccountId: "a", date: new Date("2026-11-05T00:00:00Z"), followersCount: 100 },
        { instagramAccountId: "a", date: new Date("2026-11-07T00:00:00Z"), followersCount: 110 },
        { instagramAccountId: "b", date: new Date("2026-11-06T00:00:00Z"), followersCount: 50 },
      ],
      dias,
    );
    expect(s.map((d) => d.seguidores)).toEqual([100, 150, 160, 160]);
    expect(s[0].rotulo).toBe("05/11");
  });

  it("sem coleta nenhuma fica nulo (não inventa zero)", () => {
    expect(serieSeguidores([], dias).every((d) => d.seguidores === null)).toBe(true);
  });

  it("ultimoEAnterior pega o último e o de 7 dias antes", () => {
    const serie = Array.from({ length: 10 }, (_, i) => ({ dia: `d${i}`, rotulo: "", seguidores: 100 + i }));
    expect(ultimoEAnterior(serie)).toEqual({ atual: 109, anterior: 102 });
    expect(ultimoEAnterior(serie.slice(0, 3))).toEqual({ atual: 102, anterior: null });
  });
});

describe("DMs", () => {
  const logs = [
    log("2026-11-08T13:00:00Z", "SENT"),
    log("2026-11-08T14:00:00Z", "SENT"),
    log("2026-11-08T15:00:00Z", "HELD_FOR_REVIEW"),
    log("2026-11-07T15:00:00Z", "FAILED", "ERROS", "Reel ERROS"),
    log("2026-11-07T16:00:00Z", "SKIPPED_NO_MATCH", null, "Reel ERROS"),
    log("2026-11-07T17:00:00Z", "SENT", null, "Reel ERROS"),
  ];

  it("dmsPorDia separa enviadas, seguradas e falhas por dia", () => {
    const d = dmsPorDia(logs, ["2026-11-07", "2026-11-08"]);
    expect(d[0]).toMatchObject({ enviadas: 1, seguradas: 0, falhas: 1 });
    expect(d[1]).toMatchObject({ enviadas: 2, seguradas: 1, falhas: 0 });
  });

  it("taxa comentário→DM ignora comentário sem palavra", () => {
    expect(taxaConversao(logs)).toEqual({ comentarios: 5, enviadas: 3, taxa: 60 });
    expect(taxaConversao([]).taxa).toBeNull();
  });

  it("conversão por palavra usa a campanha quando não há palavra gravada", () => {
    const p = conversaoPorPalavra(logs);
    expect(p[0]).toEqual({ palavra: "JUROS", comentarios: 3, enviadas: 2, taxa: 66.7 });
    expect(p.map((x) => x.palavra)).toEqual(["JUROS", "REEL ERROS", "ERROS"]) // empate em comentários: quem enviou mais vem antes;
  });

  it("horário dos comentários em SP e horas de pico", () => {
    const h = horarioComentarios(logs);
    expect(h).toHaveLength(24);
    expect(h[10].comentarios).toBe(1); // 13:00Z = 10h SP
    expect(h[12].comentarios).toBe(2); // 15:00Z dos dois dias
    expect(horasDePico(h, 1)).toEqual([12]);
    expect(horasDePico(horarioComentarios([]))).toEqual([]);
  });
});

describe("redes", () => {
  const snaps: SnapRede[] = [
    { rede: "tiktok", estado: "conectado", metricas: { seguidores: 400, visualizacoes_7d: 5000 }, coletadoEm: new Date("2026-10-30T12:00:00Z") },
    { rede: "tiktok", estado: "conectado", metricas: { seguidores: 440, visualizacoes_7d: 5500 }, coletadoEm: new Date("2026-11-08T12:00:00Z") },
    { rede: "youtube", estado: "conectado", metricas: { inscritos: 95 }, coletadoEm: new Date("2026-11-08T12:00:00Z") },
    { rede: "meta_ads", estado: "conectado", metricas: { gasto_mes: 0, campanhas_ativas: 0 }, coletadoEm: new Date("2026-11-08T12:00:00Z") },
    { rede: "x", estado: "sem_dados", metricas: {}, coletadoEm: new Date("2026-11-08T12:00:00Z") },
  ];

  it("cards só para redes com números, com delta contra 7 dias antes", () => {
    const cards = cardsPlataforma(snaps, null);
    expect(cards.map((c) => c.rede)).toEqual(["youtube", "tiktok", "meta_ads"]);
    const tt = cards.find((c) => c.rede === "tiktok")!;
    expect(tt.destaque).toMatchObject({ rotulo: "Seguidores", valor: 440, delta: 10 });
    expect(tt.stats[0]).toMatchObject({ valor: 5500, delta: 10 });
    expect(cards.find((c) => c.rede === "youtube")!.destaque).toMatchObject({ rotulo: "Inscritos", delta: null });
    expect(cards.find((c) => c.rede === "meta_ads")!.destaque.formato).toBe("brl");
  });

  it("Instagram entra pelo FollowerSnapshot com as estatísticas do banco", () => {
    const serie = Array.from({ length: 8 }, (_, i) => ({ dia: `d${i}`, rotulo: "", seguidores: 1000 + i * 10 }));
    const cards = cardsPlataforma([], {
      serie,
      coletadoEm: new Date("2026-11-08T00:00:00Z"),
      stats: [{ rotulo: "DMs enviadas 7d", valor: 6, formato: "numero", delta: null }],
    });
    expect(cards[0]).toMatchObject({ rede: "instagram", destaque: { valor: 1070, delta: 7 } });
    expect(cards[0].stats).toHaveLength(1);
  });

  it("total de seguidores só tem delta quando todas as redes têm base de 7 dias", () => {
    const serie = Array.from({ length: 8 }, (_, i) => ({ dia: `d${i}`, rotulo: "", seguidores: 1000 + i * 10 }));
    const t = totalSeguidores(snaps, serie);
    expect(t.atual).toBe(1070 + 440 + 95);
    expect(t.anterior).toBeNull(); // YouTube não tem snapshot de 7 dias antes
    const soTikTok = totalSeguidores(snaps.filter((s) => s.rede === "tiktok"), null);
    expect(soTikTok).toMatchObject({ atual: 440, anterior: 400 });
  });

  it("distribuição da audiência em %", () => {
    const d = distribuicaoAudiencia([
      { rede: "instagram", nome: "Instagram", seguidores: 300 },
      { rede: "tiktok", nome: "TikTok", seguidores: 100 },
      { rede: "x", nome: "X", seguidores: null },
    ]);
    expect(d).toEqual([
      { rede: "instagram", nome: "Instagram", seguidores: 300, pct: 75 },
      { rede: "tiktok", nome: "TikTok", seguidores: 100, pct: 25 },
    ]);
  });
});

describe("rótulos", () => {
  it("rótulo com sufixo de período", () => {
    expect(rotuloStat("visualizacoes_7d")).toBe("Visualizações 7d");
    expect(rotuloStat("gasto_mes")).toBe("Gasto do mês");
    expect(rotuloStat("alcance")).toBe("Alcance");
  });
});

describe("pendências", () => {
  it("rótulo da área pelo link", () => {
    expect(areaDaPendencia("/campaigns")).toBe("Campanhas");
    expect(areaDaPendencia("/dashboard/calendario")).toBe("Calendário");
    expect(areaDaPendencia("/qualquer")).toBe("Geral");
  });
});
