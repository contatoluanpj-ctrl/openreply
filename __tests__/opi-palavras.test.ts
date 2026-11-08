import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockPrisma, mockQueue, mockCtx, mockWorkspaceId } = vi.hoisted(() => {
  const mockPrisma = {
    textoAprovado: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      deleteMany: vi.fn(),
    },
    automation: { findMany: vi.fn() },
    dmLog: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), delete: vi.fn() },
  };
  const mockQueue = { getJob: vi.fn(), add: vi.fn() };
  const mockCtx = vi.fn();
  const mockWorkspaceId = vi.fn();
  return { mockPrisma, mockQueue, mockCtx, mockWorkspaceId };
});

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => ({ getCurrentWorkspaceId: mockWorkspaceId }));
vi.mock("@/lib/workspace-access", () => ({
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
  getCurrentWorkspaceContext: mockCtx,
}));
vi.mock("@/lib/queue/client", () => ({ getDMQueue: () => mockQueue }));

import { GET, POST } from "../app/api/opi/textos/route";
import { DELETE, PATCH } from "../app/api/opi/textos/[id]/route";
import { POST as REPROCESSAR } from "../app/api/opi/reprocessar/route";
import { hashTemplate } from "../lib/opi/jev-gate";
import { AVISO_OBRIGATORIO, campanhaUsaPalavra, motivoPausa } from "../lib/opi/palavras";

const DM = `Oi! Aqui está o material: https://exemplo.test/m.pdf\n${AVISO_OBRIGATORIO}`;

function req(url: string, method: string, body?: unknown) {
  return new NextRequest(`https://example.com${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

const LOG_BASE = {
  id: "log_1",
  workspaceId: "ws_1",
  status: "HELD_FOR_REVIEW",
  commentId: "c_9",
  commentText: "JUROS",
  commenterId: "u_1",
  commenterName: "fulano",
  dmSentAt: null,
  publicReplySentAt: null,
  dmDeliveryUnconfirmed: false,
  publicReplyDeliveryUnconfirmed: false,
  createdAt: new Date("2026-11-07T12:00:00.000Z"),
  automation: { id: "a_1", isActive: true, postId: "media_77" },
  instagramAccount: { id: "acc_int", instagramId: "ig_555" },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockWorkspaceId.mockResolvedValue("ws_1");
  mockCtx.mockResolvedValue({ userId: "user_luan", workspaceId: "ws_1", role: "OWNER" });
});

describe("motivoPausa e campanhaUsaPalavra", () => {
  it("ativa quando a campanha está ligada", () => {
    expect(motivoPausa(true, 0)).toBe("ativa");
    expect(motivoPausa(true, 1)).toBe("ativa");
  });
  it("aguardando revisão com exatamente 1 envio do texto atual", () => {
    expect(motivoPausa(false, 1)).toBe("aguardando_revisao");
  });
  it("pausada com 0 ou 2+ envios", () => {
    expect(motivoPausa(false, 0)).toBe("pausada");
    expect(motivoPausa(false, 2)).toBe("pausada");
  });
  it("normaliza como o portão", () => {
    expect(campanhaUsaPalavra(["juros"], "JUROS")).toBe(true);
    expect(campanhaUsaPalavra(["Proteção"], "PROTECAO")).toBe(true);
    expect(campanhaUsaPalavra(["erros"], "JUROS")).toBe(false);
    expect(campanhaUsaPalavra(null, "JUROS")).toBe(false);
  });
});

describe("GET /api/opi/textos", () => {
  it("401 sem workspace", async () => {
    mockWorkspaceId.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("junta campanhas por palavra, com motivo da pausa pelo hash do texto atual", async () => {
    mockPrisma.textoAprovado.findMany.mockResolvedValue([{ id: "t_1", palavra: "JUROS", dmMessage: DM, ativo: true }]);
    mockPrisma.automation.findMany.mockResolvedValue([
      { id: "a_1", name: "Juros Reel", keywords: ["juros"], isActive: false, dmMessage: DM, postId: "m", postUrl: null },
      { id: "a_2", name: "Erros", keywords: ["erros"], isActive: true, dmMessage: "x", postId: "m", postUrl: null },
    ]);
    mockPrisma.dmLog.findMany.mockResolvedValue([]);
    mockPrisma.dmLog.count.mockResolvedValue(1);

    const res = await GET();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data.textos[0].campanhas).toHaveLength(1);
    expect(data.textos[0].campanhas[0]).toMatchObject({ id: "a_1", motivo: "aguardando_revisao" });
    expect(mockPrisma.dmLog.count).toHaveBeenCalledWith({
      where: { automationId: "a_1", status: "SENT", dmTemplateHash: hashTemplate(DM) },
    });
    expect(mockPrisma.textoAprovado.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "ws_1" } }));
  });
});

describe("POST /api/opi/textos", () => {
  it("401 sem sessão", async () => {
    mockCtx.mockResolvedValue(null);
    expect((await POST(req("/api/opi/textos", "POST", { palavra: "x", dmMessage: DM }))).status).toBe(401);
  });
  it("403 sem permissão", async () => {
    mockCtx.mockResolvedValue({ userId: "u", workspaceId: "ws_1", role: "MEMBER" });
    expect((await POST(req("/api/opi/textos", "POST", { palavra: "x", dmMessage: DM }))).status).toBe(403);
  });
  it("400 sem o aviso obrigatório", async () => {
    const res = await POST(req("/api/opi/textos", "POST", { palavra: "juros", dmMessage: "Oi! Sem aviso." }));
    expect(res.status).toBe(400);
    expect(mockPrisma.textoAprovado.create).not.toHaveBeenCalled();
  });
  it("cria com palavra em maiúsculas, workspace e aprovadoPor da sessão", async () => {
    mockPrisma.textoAprovado.create.mockImplementation(async ({ data }) => ({ id: "t_new", ...data }));
    const res = await POST(req("/api/opi/textos", "POST", { palavra: " juros ", dmMessage: DM, workspaceId: "outro" }));
    expect(res.status).toBe(201);
    expect(mockPrisma.textoAprovado.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ palavra: "JUROS", workspaceId: "ws_1", aprovadoPor: "user_luan", ativo: true }),
    });
  });
  it("409 em palavra duplicada", async () => {
    mockPrisma.textoAprovado.create.mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    expect((await POST(req("/api/opi/textos", "POST", { palavra: "juros", dmMessage: DM }))).status).toBe(409);
  });
});

describe("PATCH/DELETE /api/opi/textos/[id]", () => {
  it("PATCH fora do workspace = 404", async () => {
    mockPrisma.textoAprovado.findFirst.mockResolvedValue(null);
    const res = await PATCH(req("/api/opi/textos/t_x", "PATCH", { ativo: false }), params("t_x"));
    expect(res.status).toBe(404);
    expect(mockPrisma.textoAprovado.findFirst).toHaveBeenCalledWith({ where: { id: "t_x", workspaceId: "ws_1" } });
    expect(mockPrisma.textoAprovado.update).not.toHaveBeenCalled();
  });
  it("PATCH de ativo não troca aprovadoPor; troca de texto registra quem aprovou", async () => {
    mockPrisma.textoAprovado.findFirst.mockResolvedValue({ id: "t_1" });
    mockPrisma.textoAprovado.update.mockResolvedValue({ id: "t_1" });
    await PATCH(req("/api/opi/textos/t_1", "PATCH", { ativo: false }), params("t_1"));
    expect(mockPrisma.textoAprovado.update).toHaveBeenLastCalledWith({ where: { id: "t_1" }, data: { ativo: false } });
    await PATCH(req("/api/opi/textos/t_1", "PATCH", { dmMessage: DM }), params("t_1"));
    expect(mockPrisma.textoAprovado.update).toHaveBeenLastCalledWith({
      where: { id: "t_1" },
      data: { dmMessage: DM, aprovadoPor: "user_luan" },
    });
  });
  it("PATCH sem aviso = 400", async () => {
    const res = await PATCH(req("/api/opi/textos/t_1", "PATCH", { dmMessage: "sem aviso" }), params("t_1"));
    expect(res.status).toBe(400);
  });
  it("DELETE fora do workspace = 404", async () => {
    mockPrisma.textoAprovado.deleteMany.mockResolvedValue({ count: 0 });
    const res = await DELETE(req("/api/opi/textos/t_x", "DELETE"), params("t_x"));
    expect(res.status).toBe(404);
    expect(mockPrisma.textoAprovado.deleteMany).toHaveBeenCalledWith({ where: { id: "t_x", workspaceId: "ws_1" } });
  });
  it("DELETE 403 sem permissão", async () => {
    mockCtx.mockResolvedValue({ userId: "u", workspaceId: "ws_1", role: "MEMBER" });
    expect((await DELETE(req("/api/opi/textos/t_1", "DELETE"), params("t_1"))).status).toBe(403);
  });
});

describe("POST /api/opi/reprocessar", () => {
  const body = { dmLogId: "log_1" };

  it("remove o job antigo, apaga o log e re-enfileira com o mesmo jobId e o Reel da campanha", async () => {
    const remove = vi.fn();
    mockPrisma.dmLog.findFirst.mockResolvedValue(LOG_BASE);
    mockQueue.getJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue("completed"), remove });

    const res = await REPROCESSAR(req("/api/opi/reprocessar", "POST", body));
    expect(res.status).toBe(200);
    expect(mockPrisma.dmLog.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "log_1", workspaceId: "ws_1" } }));
    expect(mockQueue.getJob).toHaveBeenCalledWith("comment_ig_555_c_9");
    expect(remove).toHaveBeenCalled();
    expect(mockPrisma.dmLog.delete).toHaveBeenCalledWith({ where: { id: "log_1" } });
    expect(mockQueue.add).toHaveBeenCalledWith(
      "process-comment",
      expect.objectContaining({
        instagramAccountId: "ig_555",
        accountConnectionId: "acc_int",
        commentId: "c_9",
        commentText: "JUROS",
        commenterId: "u_1",
        mediaId: "media_77",
        commentTimestamp: "2026-11-07T12:00:00.000Z",
        source: "WEBHOOK",
      }),
      { jobId: "comment_ig_555_c_9" },
    );
  });

  it("sem job antigo na fila, só re-enfileira", async () => {
    mockPrisma.dmLog.findFirst.mockResolvedValue(LOG_BASE);
    mockQueue.getJob.mockResolvedValue(undefined);
    expect((await REPROCESSAR(req("/api/opi/reprocessar", "POST", body))).status).toBe(200);
    expect(mockQueue.add).toHaveBeenCalled();
  });

  it("404 fora do workspace", async () => {
    mockPrisma.dmLog.findFirst.mockResolvedValue(null);
    expect((await REPROCESSAR(req("/api/opi/reprocessar", "POST", body))).status).toBe(404);
  });

  it("403 sem permissão", async () => {
    mockCtx.mockResolvedValue({ userId: "u", workspaceId: "ws_1", role: "MEMBER" });
    expect((await REPROCESSAR(req("/api/opi/reprocessar", "POST", body))).status).toBe(403);
  });

  it.each([
    ["DM já enviada (SENT)", { status: "SENT", dmSentAt: new Date() }],
    ["resposta pública já saiu", { status: "FAILED", publicReplySentAt: new Date() }],
    ["envio sem confirmação", { status: "FAILED", dmDeliveryUnconfirmed: true }],
    ["campanha sem postId", { automation: { id: "a_1", isActive: true, postId: null } }],
    ["campanha pausada", { automation: { id: "a_1", isActive: false, postId: "media_77" } }],
  ])("409 quando %s", async (_nome, extra) => {
    mockPrisma.dmLog.findFirst.mockResolvedValue({ ...LOG_BASE, ...extra });
    const res = await REPROCESSAR(req("/api/opi/reprocessar", "POST", body));
    expect(res.status).toBe(409);
    expect(mockPrisma.dmLog.delete).not.toHaveBeenCalled();
    expect(mockQueue.add).not.toHaveBeenCalled();
  });

  it("409 quando o job está em processamento", async () => {
    const remove = vi.fn();
    mockPrisma.dmLog.findFirst.mockResolvedValue(LOG_BASE);
    mockQueue.getJob.mockResolvedValue({ getState: vi.fn().mockResolvedValue("active"), remove });
    const res = await REPROCESSAR(req("/api/opi/reprocessar", "POST", body));
    expect(res.status).toBe(409);
    expect(remove).not.toHaveBeenCalled();
    expect(mockPrisma.dmLog.delete).not.toHaveBeenCalled();
  });
});
