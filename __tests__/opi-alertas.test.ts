import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ prisma: {} }));

import {
  alertarFalha,
  chaveAlerta,
  falhaDefinitiva,
  JANELA_ALERTA_MS,
  limparResumo,
  linkAbsoluto,
  PREFIXO_ALERTA,
  textoAlerta,
  type DbAlertas,
} from "@/lib/opi/alertas";

const ENV = { OPI_TELEGRAM_BOT_TOKEN: "123456:SEGREDO", OPI_TELEGRAM_CHAT_ID: "999", NEXTAUTH_URL: "https://painel.exemplo.com/" };
const AGORA = new Date("2026-11-12T15:00:00.000Z");

/** Banco de mentira: guarda os eventos em memória e responde ao findFirst como o Prisma (message + createdAt >=). */
function bancoFalso(iniciais: { message: string; createdAt: Date }[] = []) {
  const eventos = [...iniciais];
  const db = {
    operationalEvent: {
      findFirst: vi.fn(async ({ where }: { where: { message: string; createdAt: { gte: Date } } }) => {
        const achou = eventos.find((e) => e.message === where.message && e.createdAt >= where.createdAt.gte);
        return achou ? { id: "e1" } : null;
      }),
      create: vi.fn(async ({ data }: { data: { message: string; createdAt: Date } }) => {
        eventos.push({ message: data.message, createdAt: data.createdAt });
        return data;
      }),
    },
  };
  return { db: db as unknown as DbAlertas, eventos, mock: db.operationalEvent };
}

function telegramFalso(status = 200) {
  return vi.fn(async (_url: string, _init: { body: string }) => ({ ok: status >= 200 && status < 300, status }));
}

describe("alertarFalha", () => {
  it("fica mudo sem o token: não chama o Telegram nem o banco", async () => {
    const { db, mock } = bancoFalso();
    const f = telegramFalso();
    const r = await alertarFalha("post", "Reel não saiu", "/dashboard/calendario", { env: { OPI_TELEGRAM_CHAT_ID: "1" }, db, fetchImpl: f });
    expect(r).toBe("mudo");
    expect(f).not.toHaveBeenCalled();
    expect(mock.findFirst).not.toHaveBeenCalled();
    expect(mock.create).not.toHaveBeenCalled();
  });

  it("envia uma vez com tipo, resumo e link absoluto, e registra o envio", async () => {
    const { db, eventos } = bancoFalso();
    const f = telegramFalso();
    const r = await alertarFalha("post", "Reel de 12/11 18:00: Graph 400", "/dashboard/calendario", {
      env: ENV,
      db,
      fetchImpl: f,
      agora: AGORA,
      chave: "post:abc",
      workspaceId: "w1",
    });
    expect(r).toBe("enviado");
    expect(f).toHaveBeenCalledTimes(1);
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bot123456:SEGREDO/sendMessage");
    const corpo = JSON.parse(init.body) as { chat_id: string; text: string };
    expect(corpo.chat_id).toBe("999");
    expect(corpo.text).toContain("Post não publicado");
    expect(corpo.text).toContain("Graph 400");
    expect(corpo.text).toContain("https://painel.exemplo.com/dashboard/calendario");
    expect(corpo.text).not.toContain("SEGREDO");
    expect(eventos).toEqual([{ message: `${PREFIXO_ALERTA}post:abc`, createdAt: AGORA }]);
  });

  it("não repete o mesmo alerta em menos de 6 h e volta a enviar depois", async () => {
    const { db } = bancoFalso();
    const f = telegramFalso();
    const base = { env: ENV, db, fetchImpl: f, chave: "token:conta1" };
    expect(await alertarFalha("token", "falhou", "/settings", { ...base, agora: AGORA })).toBe("enviado");
    const cincoHoras = new Date(AGORA.getTime() + 5 * 60 * 60 * 1000);
    expect(await alertarFalha("token", "falhou", "/settings", { ...base, agora: cincoHoras })).toBe("repetido");
    expect(f).toHaveBeenCalledTimes(1);
    const depois = new Date(AGORA.getTime() + JANELA_ALERTA_MS + 60_000);
    expect(await alertarFalha("token", "falhou", "/settings", { ...base, agora: depois })).toBe("enviado");
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("chaves diferentes não se bloqueiam", async () => {
    const { db } = bancoFalso();
    const f = telegramFalso();
    await alertarFalha("post", "a", "/x", { env: ENV, db, fetchImpl: f, agora: AGORA, chave: "post:1" });
    await alertarFalha("post", "a", "/x", { env: ENV, db, fetchImpl: f, agora: AGORA, chave: "post:2" });
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("sem chave, o dedupe ignora números: 'job 12' e 'job 13' são o mesmo alerta", async () => {
    const { db } = bancoFalso();
    const f = telegramFalso();
    const base = { env: ENV, db, fetchImpl: f, agora: AGORA };
    expect(await alertarFalha("dm", "DM não saiu depois de 3 tentativa(s): erro 190", "/logs", base)).toBe("enviado");
    expect(await alertarFalha("dm", "DM não saiu depois de 1 tentativa(s): erro 190", "/logs", base)).toBe("repetido");
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("Telegram fora do ar: não registra, para a próxima falha tentar de novo", async () => {
    const { db, mock } = bancoFalso();
    const r = await alertarFalha("dm", "x", "/logs", { env: ENV, db, fetchImpl: telegramFalso(500), agora: AGORA });
    expect(r).toBe("falhou");
    expect(mock.create).not.toHaveBeenCalled();
  });

  it("nunca lança: banco quebrado ou fetch que explode viram 'falhou'", async () => {
    const quebrado = { operationalEvent: { findFirst: vi.fn(async () => { throw new Error("banco fora"); }), create: vi.fn() } } as unknown as DbAlertas;
    await expect(alertarFalha("post", "x", "/x", { env: ENV, db: quebrado, fetchImpl: telegramFalso() })).resolves.toBe("falhou");
    const { db } = bancoFalso();
    const explode = vi.fn(async () => { throw new Error("rede"); });
    await expect(alertarFalha("post", "x", "/x", { env: ENV, db, fetchImpl: explode })).resolves.toBe("falhou");
  });
});

describe("texto e chave do alerta", () => {
  it("limparResumo tira token e encurta", () => {
    expect(limparResumo("erro em https://x?access_token=ABC123&y=1")).toBe("erro em https://x?access_token=[token]&y=1");
    expect(limparResumo("POST https://api.telegram.org/bot123:AbC_d-9/sendMessage")).toContain("bot[token]");
    expect(limparResumo("a".repeat(500)).length).toBe(300);
    expect(limparResumo("linha 1\n\n  linha 2")).toBe("linha 1 linha 2");
  });

  it("chaveAlerta é estável e curta", () => {
    expect(chaveAlerta("dm", "Job 12 falhou: código 190")).toBe(chaveAlerta("dm", "job 99 falhou: código 10"));
    expect(chaveAlerta("dm", "")).toBe("dm:geral");
    expect(chaveAlerta("post", "x".repeat(300)).length).toBeLessThanOrEqual(85);
  });

  it("linkAbsoluto usa o endereço do painel e não inventa domínio", () => {
    expect(linkAbsoluto("/logs", { NEXTAUTH_URL: "https://p.com/" })).toBe("https://p.com/logs");
    expect(linkAbsoluto("/logs", { OPI_PAINEL_URL: "https://opi.com", NEXTAUTH_URL: "https://p.com" })).toBe("https://opi.com/logs");
    expect(linkAbsoluto("/logs", { NEXTAUTH_URL: "http://localhost:3000" })).toBe("/logs");
    expect(linkAbsoluto("/logs", {})).toBe("/logs");
    expect(linkAbsoluto("https://outro.com/x", { NEXTAUTH_URL: "https://p.com" })).toBe("https://outro.com/x");
  });

  it("textoAlerta tem título, resumo e link", () => {
    expect(textoAlerta("token", "falhou", "/settings", {})).toBe("OPI Central: Token do Instagram não renovou\nfalhou\nAbrir: /settings");
  });
});

describe("falhaDefinitiva", () => {
  it("só na última tentativa ou em erro irrecuperável", () => {
    expect(falhaDefinitiva({ attemptsMade: 1, opts: { attempts: 3 } }, { name: "Error" })).toBe(false);
    expect(falhaDefinitiva({ attemptsMade: 3, opts: { attempts: 3 } }, { name: "Error" })).toBe(true);
    expect(falhaDefinitiva({ attemptsMade: 1, opts: { attempts: 3 } }, { name: "UnrecoverableError" })).toBe(true);
    expect(falhaDefinitiva({ attemptsMade: 1 }, { name: "Error" })).toBe(true); // sem novas tentativas configuradas
    expect(falhaDefinitiva(undefined, { name: "Error" })).toBe(true);
  });
});
