import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Portão do Jev LIGADO de ponta a ponta no worker (comentário e gatilho por DM).
const { mockPrisma, send } = vi.hoisted(() => ({
  mockPrisma: {
    automation: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    dmLog: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    jevLedger: { createMany: vi.fn() },
    instagramAccount: { findUnique: vi.fn() },
    operationalEvent: { create: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn() },
    postbackDelivery: { create: vi.fn(), delete: vi.fn() },
  },
  send: {
    sendPrivateReply: vi.fn(),
    sendCommentReply: vi.fn(),
    sendDirectMessage: vi.fn(),
    sendPrivateReplyWithButton: vi.fn(),
    sendPrivateReplyWithLinkButton: vi.fn(),
    sendDirectMessageWithButton: vi.fn(),
    sendDirectMessageWithLinkButton: vi.fn(),
  },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/instagram/provider", () => {
  class MetaApiError extends Error { code = 0; }
  class TokenExpiredError extends Error {}
  class RateLimitError extends Error {}
  return {
    ...send,
    MetaApiError, TokenExpiredError, RateLimitError,
    getUserFollowStatus: vi.fn(async () => true),
    resolveRecipientName: vi.fn(async () => "fulano"),
    createInstagramContext: vi.fn(async () => ({ provider: "META" })),
    hasInstagramCredentials: vi.fn(() => true),
  };
});
vi.mock("@/lib/utils/rate-limiter", () => ({
  reserveDMSlot: vi.fn(async () => ({ allowed: true, reserved: true, shouldSkip: false, shouldRequeue: false, requeueDelayMs: 0 })),
  releaseDMSlot: vi.fn(),
}));
vi.mock("@/lib/billing/usage", () => ({
  reserveWorkspaceDMSend: vi.fn(async () => ({ allowed: true, reserved: true, limit: 1000, periodStart: new Date() })),
  releaseWorkspaceDMReservation: vi.fn(),
}));
vi.mock("@/lib/ops/worker-health", () => ({ recordWorkerAlert: vi.fn() }));
vi.mock("@/lib/queue/client", () => ({
  getDMQueue: () => ({ add: vi.fn() }),
  getRedisConnection: vi.fn(),
  POSTBACK_JOB_NAME: "process-postback",
  FOLLOWUP_JOB_NAME: "process-followup",
  MESSAGE_JOB_NAME: "process-message",
}));
vi.mock("bullmq", () => {
  function MockWorker(_name: string, processor: unknown) {
    (globalThis as Record<string, unknown>).__opiProcessor = processor;
    return { on: vi.fn(), close: vi.fn() };
  }
  return { Worker: MockWorker, UnrecoverableError: class extends Error {} };
});

import { createDMWorker } from "../lib/queue/dm-worker";
import { reenviarAvisosPendentes, zerarAvisosParaTeste } from "../lib/opi/jev-worker";
import { TEXTOS_DM_APROVADOS } from "../lib/opi/jev-gate";

type Proc = (job: { name?: string; data: Record<string, unknown>; id: string; attemptsMade: number }) => Promise<void>;
function processor(): Proc {
  createDMWorker();
  return (globalThis as Record<string, unknown>).__opiProcessor as Proc;
}

const automation = {
  id: "auto_1", name: "Juros", workspaceId: "ws_1", instagramAccountId: "acc_1", postId: "media_1",
  keywords: ["JUROS"], matchAnyWord: false, wholeWordMatch: true, isActive: true, dmTriggerEnabled: false,
  dmMessage: TEXTOS_DM_APROVADOS[0], openingDmEnabled: false, openingDmMessage: null, openingDmButtonLabel: null,
  linkButtonLabel: null, requireFollow: false, publicReplyEnabled: true, publicReplyMessage: "Te mandei na DM! 📩",
  publicReplyMessages: [], followUpEnabled: false, followUpMessage: null,
  instagramAccount: { id: "acc_1", instagramId: "ig_1" }, workspace: { id: "ws_1" }, trackedLinks: [],
};

function commentJob(text: string) {
  return { data: { instagramAccountId: "ig_1", commentId: "c_1", commentText: text, commenterId: "u_1", commenterName: "fulano", mediaId: "media_1" }, id: "j1", attemptsMade: 0 };
}

const jevOk = (p: Record<string, number> = {}) => ({
  answers: Object.fromEntries(Object.entries({ so_palavra: 0.95, pede_orientacao: 0.01, avalia_operacao: 0.01, reclamacao_legal: 0.01, dado_pessoal: 0.01, ...p })
    .map(([k, v]) => [k, { noul: v }])),
});

let fetchMock: ReturnType<typeof vi.fn>;
function respondeJev(body: unknown, status = 200) {
  fetchMock.mockImplementation(async (url: string) => {
    if (String(url).startsWith("https://api.telegram.org/")) return { ok: true, status: 200, json: async () => ({}) };
    return { ok: status === 200, status, json: async () => body };
  });
}
const chamadasJev = () => fetchMock.mock.calls.filter(([u]) => String(u).includes("typesafe")).length;
const chamadasTelegram = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith("https://api.telegram.org/"));
const nadaSaiu = () => {
  for (const f of Object.values(send)) expect(f).not.toHaveBeenCalled();
};
const statusGravado = () => mockPrisma.dmLog.upsert.mock.calls.map(([a]) => a.create?.status);

beforeEach(() => {
  vi.clearAllMocks();
  process.env.OPI_JEV_GATE = "";
  process.env.TYPESAFE_API_KEY = "chave-de-teste";
  process.env.OPI_TELEGRAM_BOT_TOKEN = "tok";
  process.env.OPI_TELEGRAM_CHAT_ID = "123";
  process.env.OPI_PAUSE_AFTER_FIRST_DM = "false";
  process.env.OPI_TELEGRAM_COMENTARIOS = "true"; // os testes de aviso abaixo cobrem o Telegram LIGADO
  zerarAvisosParaTeste();
  process.env.OPI_TELEGRAM_INTERVALO_MS = "0";
  mockPrisma.operationalEvent.create.mockResolvedValue({});
  mockPrisma.operationalEvent.findFirst.mockResolvedValue(null); // freio solto
  mockPrisma.operationalEvent.findMany.mockResolvedValue([]);
  mockPrisma.operationalEvent.update.mockResolvedValue({});
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mockPrisma.automation.findMany.mockResolvedValue([automation]);
  // Estado real de isActive: o updateMany condicionado desliga e o count enxerga (sem isso o mock escondia o
  // bug da pausa que barrava a própria 1ª DM).
  let ativa = true;
  mockPrisma.automation.count.mockImplementation(async ({ where }: { where: { isActive?: boolean } }) =>
    (where.isActive === undefined || where.isActive === ativa ? 1 : 0));
  mockPrisma.automation.updateMany.mockImplementation(async ({ where, data }: { where: { isActive?: boolean }; data: { isActive: boolean } }) => {
    if (where.isActive !== undefined && where.isActive !== ativa) return { count: 0 };
    ativa = data.isActive;
    return { count: 1 };
  });
  mockPrisma.dmLog.findUnique.mockResolvedValue(null);
  mockPrisma.dmLog.findFirst.mockResolvedValue(null);
  mockPrisma.dmLog.upsert.mockResolvedValue({});
  mockPrisma.dmLog.update.mockResolvedValue({});
  mockPrisma.dmLog.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.dmLog.count.mockResolvedValue(0);
  mockPrisma.jevLedger.createMany.mockResolvedValue({ count: 5 });
  for (const f of Object.values(send)) f.mockResolvedValue({ message_id: "m" });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("worker com o portão do Jev ligado (comentário)", () => {
  it("só a palavra + Jev limpo: envia DM e resposta pública, grava decisão e ledger", async () => {
    respondeJev(jevOk());
    await processor()(commentJob("JUROS 🙏"));
    expect(chamadasJev()).toBe(1);
    expect(send.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(send.sendCommentReply).toHaveBeenCalledTimes(1);
    expect(mockPrisma.jevLedger.createMany.mock.calls[0][0].data).toHaveLength(5);
    expect(mockPrisma.dmLog.upsert.mock.calls[0][0].create).toMatchObject({ status: "PENDING", jevDecision: "enviar" });
    expect(chamadasTelegram()).toHaveLength(0);
  });

  it("texto além da palavra (triagem): nada sai, fica HELD_FOR_REVIEW e o Luan é avisado", async () => {
    respondeJev(jevOk({ so_palavra: 0.99 }));
    await processor()(commentJob("JUROS adorei o vídeo, mas e minha carteira?"));
    nadaSaiu();
    expect(statusGravado()).toContain("HELD_FOR_REVIEW");
    const tg = chamadasTelegram();
    expect(tg).toHaveLength(1);
    const corpo = JSON.parse(tg[0][1].body);
    expect(corpo.chat_id).toBe("123");
    expect(corpo.text).toContain("Juros");
    expect(corpo.text).toContain("@fulano");
  });

  it("Jev marca Compliance: nem DM nem resposta pública", async () => {
    respondeJev(jevOk({ reclamacao_legal: 0.05 }));
    await processor()(commentJob("JUROS"));
    nadaSaiu();
    expect(mockPrisma.dmLog.upsert.mock.calls[0][0].create).toMatchObject({ status: "HELD_FOR_REVIEW", jevDecision: "compliance" });
  });

  it("sem TYPESAFE_API_KEY: fail-closed, sem chamar o Jev", async () => {
    delete process.env.TYPESAFE_API_KEY;
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    expect(chamadasJev()).toBe(0);
    nadaSaiu();
    expect(statusGravado()).toContain("HELD_FOR_REVIEW");
  });

  it("Jev com 500 em todas as tentativas: 3 chamadas e revisão manual", async () => {
    vi.useFakeTimers();
    try {
      respondeJev({}, 500);
      const p = processor()(commentJob("JUROS"));
      await vi.runAllTimersAsync();
      await p;
    } finally {
      vi.useRealTimers();
    }
    expect(chamadasJev()).toBe(3);
    nadaSaiu();
    expect(mockPrisma.dmLog.upsert.mock.calls[0][0].create).toMatchObject({ status: "HELD_FOR_REVIEW", jevDecision: "manual_jev_falhou" });
  });

  it("falha do Telegram não derruba o job", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("https://api.telegram.org/")) throw new Error("telegram fora");
      return { ok: true, status: 200, json: async () => jevOk({ pede_orientacao: 0.5 }) };
    });
    await expect(processor()(commentJob("JUROS qual strike eu compro?"))).resolves.toBeUndefined();
    nadaSaiu();
  });

  it("log já segurado não volta a chamar o Jev nem envia", async () => {
    respondeJev(jevOk());
    mockPrisma.dmLog.findUnique.mockResolvedValue({ status: "HELD_FOR_REVIEW", attempts: 0, dmDeliveryUnconfirmed: false });
    await processor()(commentJob("JUROS"));
    expect(chamadasJev()).toBe(0);
    nadaSaiu();
  });

  it("campanha matchAnyWord é segurada (não aprovada)", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([{ ...automation, matchAnyWord: true, keywords: [] }]);
    respondeJev(jevOk({ so_palavra: 0.99 }));
    await processor()(commentJob("adorei"));
    expect(chamadasJev()).toBe(0);
    nadaSaiu();
    expect(statusGravado()).toContain("HELD_FOR_REVIEW");
  });

  it("OPI_JEV_GATE=off: comportamento original, sem Jev", async () => {
    process.env.OPI_JEV_GATE = "off";
    respondeJev(jevOk());
    await processor()(commentJob("JUROS adorei"));
    expect(chamadasJev()).toBe(0);
    expect(send.sendPrivateReply).toHaveBeenCalledTimes(1);
  });
});

describe("resposta pública só com a frase aprovada (02/11/2026)", () => {
  it("frase aprovada: sai exatamente \"Te mandei na DM! 📩\"", async () => {
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    expect(send.sendCommentReply).toHaveBeenCalledTimes(1);
    expect(send.sendCommentReply.mock.calls[0][0].message).toBe("Te mandei na DM! 📩");
  });

  it("outro texto na campanha: nenhuma resposta pública, a DM segue", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...automation, publicReplyMessage: null, publicReplyMessages: ["Enviado, {username}! Confira a DM 😉"] },
    ]);
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    expect(send.sendCommentReply).not.toHaveBeenCalled();
    expect(send.sendPrivateReply).toHaveBeenCalledTimes(1);
  });

  it("pool misto: só a frase aprovada é usada", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([
      { ...automation, publicReplyMessages: ["Olha a DM!", "Te mandei na DM! 📩", "Corre lá"] },
    ]);
    respondeJev(jevOk());
    for (let i = 0; i < 5; i++) await processor()(commentJob("JUROS"));
    for (const [arg] of send.sendCommentReply.mock.calls) expect(arg.message).toBe("Te mandei na DM! 📩");
  });

  it("comentário segurado pelo Jev: nem a frase aprovada sai", async () => {
    respondeJev(jevOk({ pede_orientacao: 0.5 }));
    await processor()(commentJob("JUROS"));
    expect(send.sendCommentReply).not.toHaveBeenCalled();
  });
});

describe("comentário que nenhuma campanha casou", () => {
  it("nada sai, sem Jev, e o Luan é avisado no Telegram", async () => {
    respondeJev(jevOk());
    await processor()(commentJob("que vídeo bom, parabéns"));
    expect(chamadasJev()).toBe(0);
    nadaSaiu();
    const tg = chamadasTelegram();
    expect(tg).toHaveLength(1);
    const corpo = JSON.parse(tg[0][1].body);
    expect(corpo.text).toContain("@fulano");
    expect(corpo.text).toContain("que vídeo bom");
    expect(corpo.text).toContain("media_1");
  });

  it("sem campanha ativa no post (DM pausada): também avisa", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([]);
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    nadaSaiu();
    expect(chamadasTelegram()).toHaveLength(1);
  });

  it("comentário que casou não gera o aviso de sem campanha", async () => {
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    expect(chamadasTelegram()).toHaveLength(0);
  });

  it("OPI_JEV_GATE=off: sem aviso", async () => {
    process.env.OPI_JEV_GATE = "off";
    respondeJev(jevOk());
    await processor()(commentJob("que vídeo bom"));
    expect(chamadasTelegram()).toHaveLength(0);
  });
});

describe("pausa da 1ª DM (OPI_PAUSE_AFTER_FIRST_DM=true)", () => {
  it("1ª DM da campanha: desativa a campanha, envia esta e avisa", async () => {
    process.env.OPI_PAUSE_AFTER_FIRST_DM = "true";
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    expect(mockPrisma.automation.updateMany).toHaveBeenCalledWith({ where: { id: "auto_1", isActive: true }, data: { isActive: false } });
    expect(send.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(send.sendCommentReply).toHaveBeenCalledTimes(1);
    expect(chamadasTelegram().map(([, i]) => JSON.parse(i.body).text).join("\n")).toMatch(/PAUSADA/);
  });

  it("depois da 1ª DM, o 2º comentário não sai (campanha pausada) e fica PENDING", async () => {
    process.env.OPI_PAUSE_AFTER_FIRST_DM = "true";
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    vi.mocked(send.sendPrivateReply).mockClear();
    vi.mocked(send.sendCommentReply).mockClear();
    const job2 = { ...commentJob("JUROS"), data: { ...commentJob("JUROS").data, commentId: "c_2" } };
    await processor()(job2);
    expect(send.sendPrivateReply).not.toHaveBeenCalled();
    expect(send.sendCommentReply).not.toHaveBeenCalled();
    expect(statusGravado()).not.toContain("HELD_FOR_REVIEW");
  });

  it("limite do plano antes do envio: não pausa a campanha à toa", async () => {
    process.env.OPI_PAUSE_AFTER_FIRST_DM = "true";
    respondeJev(jevOk());
    mockPrisma.dmLog.findFirst.mockResolvedValue({ automation: { name: "outra" } }); // outra campanha já usou a resposta privada
    await processor()(commentJob("JUROS"));
    expect(mockPrisma.automation.updateMany).not.toHaveBeenCalled();
    expect(chamadasTelegram()).toHaveLength(0);
  });

  it("campanha já pausada por outro job: não envia nada e não segura para sempre (volta quando reativar)", async () => {
    process.env.OPI_PAUSE_AFTER_FIRST_DM = "true";
    mockPrisma.automation.updateMany.mockResolvedValue({ count: 0 });
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    nadaSaiu();
    expect(statusGravado()).not.toContain("HELD_FOR_REVIEW");
    expect(mockPrisma.dmLog.upsert.mock.calls.some(([x]) => x.update?.jevDecision === "enviar")).toBe(true);
  });

  it("pausa DESLIGADA por padrão (variável ausente): a 1ª DM sai e a campanha segue ativa", async () => {
    delete process.env.OPI_PAUSE_AFTER_FIRST_DM;
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    expect(mockPrisma.automation.updateMany).not.toHaveBeenCalled();
    expect(send.sendPrivateReply).toHaveBeenCalledTimes(1);
  });

  it("Telegram de comentário DESLIGADO por padrão: nada vai ao Telegram, fica só o registro", async () => {
    delete process.env.OPI_TELEGRAM_COMENTARIOS;
    process.env.OPI_PAUSE_AFTER_FIRST_DM = "true";
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    expect(send.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(chamadasTelegram()).toHaveLength(0);
    expect(mockPrisma.operationalEvent.create).toHaveBeenCalled();
  });

  it("a pausa conta só envios do MESMO texto (1ª DM de cada fase)", async () => {
    process.env.OPI_PAUSE_AFTER_FIRST_DM = "true";
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    const c = mockPrisma.dmLog.count.mock.calls.find(([a]) => a.where?.dmTemplateHash);
    expect(c?.[0].where).toMatchObject({ status: "SENT", dmTemplateHash: expect.any(String) });
  });

  it("já houve DM enviada: segue normal, sem nova pausa", async () => {
    process.env.OPI_PAUSE_AFTER_FIRST_DM = "true";
    mockPrisma.dmLog.count.mockResolvedValue(1);
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    expect(mockPrisma.automation.updateMany).not.toHaveBeenCalled();
    expect(send.sendPrivateReply).toHaveBeenCalledTimes(1);
  });
});

describe("gatilho por DM/Story", () => {
  const msgJob = (text: string) => ({ name: "process-message", data: { instagramAccountId: "ig_1", messageId: "mid_1", messageText: text, senderId: "u_1" }, id: "j2", attemptsMade: 0 });

  it("mensagem com texto extra: nada sai", async () => {
    respondeJev(jevOk());
    await processor()(msgJob("JUROS e qual ação comprar?"));
    nadaSaiu();
    expect(statusGravado()).toContain("HELD_FOR_REVIEW");
  });

  it("gatilho por DM/Story não é aprovado: segura sem chamar o Jev", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([{ ...automation, dmTriggerEnabled: true }]);
    respondeJev(jevOk());
    await processor()(msgJob("juros"));
    expect(chamadasJev()).toBe(0);
    nadaSaiu();
    expect(mockPrisma.dmLog.upsert.mock.calls[0][0].create).toMatchObject({ status: "HELD_FOR_REVIEW", jevDecision: "bloqueado_template" });
  });
});

describe("achados do fiscal (02/11/2026)", () => {
  it("texto da DM diferente do aprovado: segura, sem Jev e sem envio", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([{ ...automation, dmMessage: "Oi! Toma o PDF: https://x.y" }]);
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    expect(chamadasJev()).toBe(0);
    nadaSaiu();
    expect(mockPrisma.dmLog.upsert.mock.calls[0][0].create).toMatchObject({ status: "HELD_FOR_REVIEW", jevDecision: "bloqueado_template" });
  });

  it.each([
    ["palavra de outro material (TERMOS com texto de JUROS)", { keywords: ["TERMOS"] }],
    ["\"qualquer post\"", { matchAnyPost: true }],
    ["\"próximo Reel\"", { pendingNextReel: true }],
    ["link rastreado", { trackedLinks: [{ slug: "s", label: null, destinationUrl: "https://x" }] }],
    ["DM de abertura", { openingDmEnabled: true, openingDmMessage: "Oi", openingDmButtonLabel: "ok" }],
    ["exigir seguir", { requireFollow: true }],
    ["follow-up", { followUpEnabled: true, followUpMessage: "e aí?" }],
  ])("%s: segura", async (_n, extra) => {
    mockPrisma.automation.findMany.mockResolvedValue([{ ...automation, ...extra }]);
    respondeJev(jevOk());
    await processor()(commentJob((extra as { keywords?: string[] }).keywords?.[0] ?? "JUROS"));
    nadaSaiu();
    expect(statusGravado()).toContain("HELD_FOR_REVIEW");
  });

  it("comentário com mais de 7 dias: lista manual, sem Jev", async () => {
    respondeJev(jevOk());
    const job = commentJob("JUROS");
    (job.data as Record<string, unknown>).commentTimestamp = new Date(Date.now() - 8 * 86400_000).toISOString();
    await processor()(job);
    expect(chamadasJev()).toBe(0);
    nadaSaiu();
    expect(mockPrisma.dmLog.upsert.mock.calls[0][0].create).toMatchObject({ status: "HELD_FOR_REVIEW", jevDecision: "fora_da_janela" });
  });

  it("comentário de 6 dias segue normal", async () => {
    respondeJev(jevOk());
    const job = commentJob("JUROS");
    (job.data as Record<string, unknown>).commentTimestamp = new Date(Date.now() - 6 * 86400_000).toISOString();
    await processor()(job);
    expect(send.sendPrivateReply).toHaveBeenCalledTimes(1);
  });

  it("resposta pública sai DEPOIS da DM confirmada", async () => {
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    expect(send.sendCommentReply.mock.invocationCallOrder[0]).toBeGreaterThan(send.sendPrivateReply.mock.invocationCallOrder[0]);
  });

  it("DM falhou: a frase pública não sai", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    respondeJev(jevOk());
    send.sendPrivateReply.mockRejectedValue(new Error("restrito"));
    await processor()(commentJob("JUROS")).catch(() => {});
    expect(send.sendCommentReply).not.toHaveBeenCalled();
  });

  it("o envio grava o hash do texto no DmLog", async () => {
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    const sent = mockPrisma.dmLog.update.mock.calls.find(([a]) => a.data?.status === "SENT");
    expect(sent?.[0].data.dmTemplateHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("freio puxado com o job em curso: não envia nem segura", async () => {
    respondeJev(jevOk());
    mockPrisma.automation.count.mockResolvedValue(0);
    await processor()(commentJob("JUROS"));
    nadaSaiu();
    expect(statusGravado()).not.toContain("HELD_FOR_REVIEW");
  });

  it("dado pessoal: o texto do comentário não vai ao Telegram", async () => {
    respondeJev(jevOk({ dado_pessoal: 0.9 }));
    await processor()(commentJob("JUROS meu cpf 123.456.789-00"));
    const corpo = JSON.parse(chamadasTelegram()[0][1].body).text;
    expect(corpo).not.toContain("123");
    expect(corpo).toContain("omitido");
    expect(corpo).toContain("c_1");
  });

  it("aviso sem campanha mascara números e e-mail", async () => {
    respondeJev(jevOk());
    await processor()(commentJob("me chama 11 98765-4321 ou ana@exemplo.com"));
    const corpo = JSON.parse(chamadasTelegram()[0][1].body).text;
    expect(corpo).not.toContain("98765");
    expect(corpo).not.toContain("ana@exemplo.com");
  });

  it("um aviso por comentário, mesmo com várias campanhas", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([automation, { ...automation, id: "auto_2" }]);
    respondeJev(jevOk({ pede_orientacao: 0.5 }));
    await processor()(commentJob("JUROS qual strike?"));
    expect(chamadasTelegram()).toHaveLength(1);
  });

  it("teto só para \"sem campanha\": excedente registrado com o id; caso segurado sempre avisa", async () => {
    respondeJev(jevOk({ reclamacao_legal: 0.5 }));
    const job = (t: string, i: number) => ({ ...commentJob(t), data: { ...commentJob(t).data, commentId: "x" + i } });
    for (let i = 0; i < 25; i++) await processor()(job("parabéns", i));
    expect(chamadasTelegram()).toHaveLength(20);
    const suprimidos = mockPrisma.operationalEvent.create.mock.calls.filter(([a]) => a.data.message === "opi.telegram.suprimido");
    expect(suprimidos).toHaveLength(5);
    expect(suprimidos[0][0].data.payload).toMatchObject({ commentId: "x20", tipo: "sem_campanha" });
    await processor()(job("JUROS", 99));
    expect(chamadasTelegram()).toHaveLength(21);
  });

  it("aviso que falhou fica registrado com o texto e sai no ciclo de reenvio", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let falhar = true;
    fetchMock.mockImplementation(async (url: string) => {
      if (String(url).startsWith("https://api.telegram.org/")) return { ok: !falhar, status: falhar ? 500 : 200, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => jevOk({ pede_orientacao: 0.5 }) };
    });
    await processor()(commentJob("JUROS qual strike?"));
    const ev = mockPrisma.operationalEvent.create.mock.calls.find(([a]) => a.data.message === "opi.telegram.falhou");
    expect(ev?.[0].data.payload).toMatchObject({ commentId: "c_1", tipo: "segurado", decisao: "luan" });
    expect(ev?.[0].data.payload.texto).toContain("segurado");
    // Ciclo de reenvio: Telegram ainda fora → não marca; Telegram de volta → entrega e marca resolvedAt.
    mockPrisma.operationalEvent.findMany.mockResolvedValue([{ id: "ev1", payload: ev![0].data.payload }]);
    expect(await reenviarAvisosPendentes()).toMatchObject({ reenviados: 0, pendentes: 1 });
    expect(mockPrisma.operationalEvent.update).not.toHaveBeenCalled();
    falhar = false;
    expect(await reenviarAvisosPendentes()).toMatchObject({ reenviados: 1 });
    expect(mockPrisma.operationalEvent.update).toHaveBeenCalledWith({ where: { id: "ev1" }, data: { resolvedAt: expect.any(Date) } });
    expect(JSON.parse(chamadasTelegram().at(-1)![1].body).text).toMatch(/^\(Aviso atrasado\)/);
  });

  it("freio global: com /pausar_dm valendo, nada sai mesmo com a campanha reativada no painel", async () => {
    respondeJev(jevOk());
    mockPrisma.operationalEvent.findFirst.mockResolvedValue({ message: "opi.freio.pausar", payload: { ids: [] } });
    await processor()(commentJob("JUROS"));
    nadaSaiu();
    expect(statusGravado()).not.toContain("HELD_FOR_REVIEW");
  });

  it("freio global: resposta pública pendente de DM antiga também não sai", async () => {
    mockPrisma.dmLog.findUnique.mockResolvedValue({ status: "SENT", attempts: 1, dmDeliveryUnconfirmed: false, publicReplySentAt: null, jevDecision: "enviar" });
    mockPrisma.operationalEvent.findFirst.mockResolvedValue({ message: "opi.freio.pausar", payload: { ids: [] } });
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    expect(send.sendCommentReply).not.toHaveBeenCalled();
  });

  it("1ª DM que falha: aviso de falha, nunca \"ENVIADA\"", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    process.env.OPI_PAUSE_AFTER_FIRST_DM = "true";
    respondeJev(jevOk());
    send.sendPrivateReply.mockRejectedValue(new Error("restrito"));
    await processor()(commentJob("JUROS")).catch(() => {});
    const textos = chamadasTelegram().map(([, i]) => JSON.parse(i.body).text).join("\n");
    // Erro genérico = entrega não confirmada (pode ter saído): o aviso manda conferir no Instagram.
    expect(textos).toMatch(/NÃO foi confirmada/);
    expect(textos).not.toMatch(/ENVIADA/);
  });

  it("reativada pela Compliance: a próxima DM sai normal, sem nova pausa", async () => {
    process.env.OPI_PAUSE_AFTER_FIRST_DM = "true";
    respondeJev(jevOk());
    mockPrisma.dmLog.count.mockResolvedValue(1); // já há uma DM SENT com este texto
    mockPrisma.dmLog.findUnique.mockResolvedValue({ status: "PENDING", attempts: 0, dmDeliveryUnconfirmed: false, publicReplySentAt: null, jevDecision: "enviar" });
    await processor()(commentJob("JUROS"));
    expect(chamadasJev()).toBe(0); // decisão "enviar" reaproveitada
    expect(mockPrisma.automation.updateMany).not.toHaveBeenCalled();
    expect(send.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(send.sendCommentReply).toHaveBeenCalledTimes(1);
  });

  it("log SENT não é rebaixado quando o Jev segura no reenvio da resposta pública", async () => {
    mockPrisma.dmLog.findUnique.mockResolvedValue({ status: "SENT", attempts: 1, dmDeliveryUnconfirmed: false, publicReplySentAt: null, jevDecision: null });
    respondeJev(jevOk({ pede_orientacao: 0.5 }));
    await processor()(commentJob("JUROS"));
    expect(statusGravado()).not.toContain("HELD_FOR_REVIEW");
    expect(mockPrisma.dmLog.update.mock.calls.some(([a]) => a.data?.jevDecision === "luan" && !a.data?.status)).toBe(true);
    expect(JSON.parse(chamadasTelegram()[0][1].body).text).toMatch(/já tinha sido enviada/);
  });
});
