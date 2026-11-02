import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Portão do Jev LIGADO de ponta a ponta no worker (comentário e gatilho por DM).
const { mockPrisma, send } = vi.hoisted(() => ({
  mockPrisma: {
    automation: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), updateMany: vi.fn() },
    dmLog: { findUnique: vi.fn(), findFirst: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    jevLedger: { createMany: vi.fn() },
    instagramAccount: { findUnique: vi.fn() },
    operationalEvent: { create: vi.fn() },
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

type Proc = (job: { name?: string; data: Record<string, unknown>; id: string; attemptsMade: number }) => Promise<void>;
function processor(): Proc {
  createDMWorker();
  return (globalThis as Record<string, unknown>).__opiProcessor as Proc;
}

const automation = {
  id: "auto_1", name: "Juros", workspaceId: "ws_1", instagramAccountId: "acc_1", postId: "media_1",
  keywords: ["JUROS"], matchAnyWord: false, wholeWordMatch: true, isActive: true, dmTriggerEnabled: true,
  dmMessage: "Oi! Aqui está o material.", openingDmEnabled: false, openingDmMessage: null, openingDmButtonLabel: null,
  linkButtonLabel: null, requireFollow: false, publicReplyEnabled: true, publicReplyMessage: "Te mandei na DM!",
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
  delete process.env.OPI_PAUSE_AFTER_FIRST_DM;
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  mockPrisma.automation.findMany.mockResolvedValue([automation]);
  mockPrisma.automation.count.mockResolvedValue(1);
  mockPrisma.automation.updateMany.mockResolvedValue({ count: 1 });
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

  it("campanha matchAnyWord passa pelo filtro", async () => {
    mockPrisma.automation.findMany.mockResolvedValue([{ ...automation, matchAnyWord: true, keywords: [] }]);
    respondeJev(jevOk({ so_palavra: 0.99 }));
    await processor()(commentJob("adorei"));
    expect(chamadasJev()).toBe(1);
    nadaSaiu();
  });

  it("OPI_JEV_GATE=off: comportamento original, sem Jev", async () => {
    process.env.OPI_JEV_GATE = "off";
    respondeJev(jevOk());
    await processor()(commentJob("JUROS adorei"));
    expect(chamadasJev()).toBe(0);
    expect(send.sendPrivateReply).toHaveBeenCalledTimes(1);
  });
});

describe("pausa da 1ª DM (OPI_PAUSE_AFTER_FIRST_DM=true)", () => {
  it("1ª DM da campanha: desativa a campanha, envia esta e avisa", async () => {
    process.env.OPI_PAUSE_AFTER_FIRST_DM = "true";
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    expect(mockPrisma.automation.updateMany).toHaveBeenCalledWith({ where: { id: "auto_1", isActive: true }, data: { isActive: false } });
    expect(send.sendPrivateReply).toHaveBeenCalledTimes(1);
    expect(chamadasTelegram().map(([, i]) => JSON.parse(i.body).text).join("\n")).toMatch(/PAUSADA/);
  });

  it("campanha já pausada por outro job: não envia nada", async () => {
    process.env.OPI_PAUSE_AFTER_FIRST_DM = "true";
    mockPrisma.automation.updateMany.mockResolvedValue({ count: 0 });
    respondeJev(jevOk());
    await processor()(commentJob("JUROS"));
    nadaSaiu();
    expect(mockPrisma.dmLog.upsert.mock.calls.at(-1)![0].update).toMatchObject({ status: "HELD_FOR_REVIEW", jevDecision: "campanha_pausada" });
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

  it("só a palavra + Jev limpo: envia a DM", async () => {
    respondeJev(jevOk());
    await processor()(msgJob("juros"));
    expect(chamadasJev()).toBe(1);
    expect(send.sendDirectMessage).toHaveBeenCalledTimes(1);
  });
});
