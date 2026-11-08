import { describe, expect, it } from "vitest";
import {
  diaSP,
  diasDaJanela,
  inicioJanela,
  montarStatsCampanhas,
  periodoValido,
  taxa,
  type LogLinha,
} from "@/lib/opi/campanhas-dados";

// 08/11/2026 15:00 em São Paulo
const AGORA = new Date("2026-11-08T18:00:00.000Z");

const log = (p: Partial<LogLinha> & { automationId: string }): LogLinha => ({
  status: "SENT",
  createdAt: new Date("2026-11-08T12:00:00.000Z"),
  dmSentAt: new Date("2026-11-08T12:00:05.000Z"),
  publicReplySentAt: null,
  ...p,
});

const campanhas = [
  { id: "a", name: "Termos", isActive: true, keywords: ["TERMOS"], username: "opi" },
  { id: "b", name: "Call", isActive: false, keywords: ["CALL", "PUT"] },
  { id: "c", name: "Sem uso", isActive: true, keywords: [] },
];

describe("janelas em São Paulo", () => {
  it("dia SP vira à meia-noite local, não UTC", () => {
    expect(diaSP(new Date("2026-11-09T02:59:00.000Z"))).toBe("2026-11-08");
    expect(diaSP(new Date("2026-11-09T03:00:00.000Z"))).toBe("2026-11-09");
  });
  it("janela de 7 dias começa 6 dias antes, 00:00 SP", () => {
    expect(inicioJanela(AGORA, 7).toISOString()).toBe("2026-11-02T03:00:00.000Z");
    const dias = diasDaJanela(AGORA, 7);
    expect(dias).toHaveLength(7);
    expect(dias[0]).toBe("2026-11-02");
    expect(dias[6]).toBe("2026-11-08");
  });
  it("período inválido cai em 30", () => {
    expect(periodoValido("7")).toBe(7);
    expect(periodoValido("90")).toBe(90);
    expect(periodoValido("15")).toBe(30);
    expect(periodoValido(null)).toBe(30);
  });
  it("taxa com uma casa e null sem base", () => {
    expect(taxa(1, 3)).toBe(33.3);
    expect(taxa(0, 0)).toBeNull();
  });
});

describe("montarStatsCampanhas", () => {
  it("vazio: zeros, taxa null, dias preenchidos", () => {
    const s = montarStatsCampanhas({ agora: AGORA, periodo: 7, campanhas, logs: [] });
    expect(s.kpis).toEqual({ ativas: 2, total: 3, comentarios: 0, dms: 0, taxa: null, seguradas: 0 });
    expect(s.porDia).toHaveLength(7);
    expect(s.porDia.every((d) => d.dms === 0 && d.comentarios === 0)).toBe(true);
    expect(s.porCampanha.map((c) => c.taxa)).toEqual([null, null, null]);
  });

  it("conta comentários, DMs, seguradas, resposta pública e ordena por comentários", () => {
    const logs: LogLinha[] = [
      log({ automationId: "b", publicReplySentAt: new Date("2026-11-08T12:00:06.000Z") }),
      log({ automationId: "b", status: "FAILED", dmSentAt: null }),
      log({ automationId: "b", status: "HELD_FOR_REVIEW", dmSentAt: null }),
      log({ automationId: "a" }),
      log({ automationId: "a", status: "SKIPPED_DEDUP", dmSentAt: null, publicReplySentAt: new Date("2026-11-07T12:00:00.000Z") }),
      // fora da janela de 7 dias: ignorado
      log({ automationId: "a", createdAt: new Date("2026-10-20T12:00:00.000Z"), dmSentAt: new Date("2026-10-20T12:00:00.000Z") }),
    ];
    const s = montarStatsCampanhas({
      agora: AGORA,
      periodo: 7,
      campanhas,
      logs,
      ultimosEnvios: { a: new Date("2026-11-08T12:00:05.000Z") },
    });
    expect(s.kpis.comentarios).toBe(5);
    expect(s.kpis.dms).toBe(2);
    expect(s.kpis.taxa).toBe(40);
    expect(s.kpis.seguradas).toBe(1);
    expect(s.resposta).toEqual({ ambas: 1, soDm: 1, soPublica: 1, nenhuma: 2 });
    expect(s.porCampanha.map((c) => c.id)).toEqual(["b", "a", "c"]);
    const b = s.porCampanha[0];
    expect(b).toMatchObject({ comentarios: 3, dms: 1, seguradas: 1, taxa: 33.3, ativa: false, ultimoEnvio: null });
    expect(s.porCampanha[1]).toMatchObject({ comentarios: 2, dms: 1, taxa: 50, username: "opi", ultimoEnvio: "2026-11-08T12:00:05.000Z" });
    const hoje = s.porDia.find((d) => d.dia === "2026-11-08")!;
    expect(hoje).toEqual({ dia: "2026-11-08", dms: 2, comentarios: 5 });
  });

  it("DM conta no dia em que saiu (dmSentAt), comentário no dia em que chegou", () => {
    const s = montarStatsCampanhas({
      agora: AGORA,
      periodo: 7,
      campanhas,
      logs: [log({ automationId: "a", createdAt: new Date("2026-11-07T02:30:00.000Z"), dmSentAt: new Date("2026-11-07T03:30:00.000Z") })],
    });
    expect(s.porDia.find((d) => d.dia === "2026-11-06")).toEqual({ dia: "2026-11-06", dms: 0, comentarios: 1 });
    expect(s.porDia.find((d) => d.dia === "2026-11-07")).toEqual({ dia: "2026-11-07", dms: 1, comentarios: 0 });
  });

  it("log de campanha desconhecida entra no total mas não na lista", () => {
    const s = montarStatsCampanhas({ agora: AGORA, periodo: 30, campanhas, logs: [log({ automationId: "x" })] });
    expect(s.kpis.comentarios).toBe(1);
    expect(s.porCampanha.every((c) => c.comentarios === 0)).toBe(true);
  });
});
