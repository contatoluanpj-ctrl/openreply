import { describe, expect, it } from "vitest";
import { diaSP, horaSP } from "@/lib/opi/posts-schema";

describe("hora e dia do Calendário no fuso America/Sao_Paulo", () => {
  it("18:00 de São Paulo é 21:00 UTC", () => {
    expect(horaSP("2026-11-14T21:00:00.000Z")).toBe("18:00");
    expect(diaSP("2026-11-14T21:00:00.000Z")).toBe("2026-11-14");
  });

  it("perto da meia-noite o dia é o de São Paulo, não o UTC", () => {
    expect(horaSP("2026-11-15T02:30:00.000Z")).toBe("23:30");
    expect(diaSP("2026-11-15T02:30:00.000Z")).toBe("2026-11-14");
  });

  it("meia-noite sai 00:00 (24 h), nunca 24:00", () => {
    expect(horaSP("2026-11-15T03:00:00.000Z")).toBe("00:00");
  });

  it("data inválida não quebra a grade", () => {
    expect(horaSP("não é data")).toBe("--:--");
  });
});
