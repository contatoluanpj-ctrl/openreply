import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => unknown) => fn }));

import { desserializarComDatas, serializarComDatas } from "@/lib/opi/dashboard-cache";

describe("cache do Dashboard: datas atravessam o cache e voltam como Date", () => {
  it("ida e volta preserva Date em qualquer profundidade e não mexe no resto", () => {
    const agora = new Date("2026-11-08T21:00:00.000Z");
    const original = {
      agora,
      kpis: { seguidores: { ok: true, dados: { valor: 1240, delta: null } } },
      serie: [{ dia: "2026-11-08", em: new Date("2026-11-08T03:00:00.000Z"), n: 3 }],
      texto: "Conteúdo educativo.",
      objeto: { $d: 1 },
    };
    const volta = desserializarComDatas<typeof original>(serializarComDatas(original));
    expect(volta.agora).toBeInstanceOf(Date);
    expect(volta.agora.toISOString()).toBe(agora.toISOString());
    expect(volta.serie[0].em).toBeInstanceOf(Date);
    expect(volta.kpis).toEqual(original.kpis);
    expect(volta.texto).toBe(original.texto);
    expect(volta.objeto).toEqual({ $d: 1 }); // só {"$d": "<texto>"} vira data
  });
});
