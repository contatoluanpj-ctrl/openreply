import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockPrisma, auth, access } = vi.hoisted(() => ({
  mockPrisma: {
    postAgendado: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    postDestino: { createMany: vi.fn(async () => ({ count: 0 })), updateMany: vi.fn(async () => ({ count: 0 })) },
    user: { findUnique: vi.fn() },
  },
  auth: { getCurrentWorkspaceId: vi.fn() },
  access: { getCurrentWorkspaceContext: vi.fn() },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => auth);
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: access.getCurrentWorkspaceContext,
  canManageWorkspace: (role: string) => role === "ADMIN" || role === "OWNER",
}));

import { GET, POST } from "@/app/api/opi/posts/route";
import { PATCH } from "@/app/api/opi/posts/[id]/route";
import { POST as APROVAR } from "@/app/api/opi/posts/aprovar-mes/route";
import { AVISO_OBRIGATORIO } from "@/lib/opi/aviso";
import { mesIntervalo } from "@/lib/opi/posts-schema";

const CTX = { userId: "u1", workspaceId: "w1", role: "OWNER" };
const futuro = new Date(Date.now() + 7 * 86_400_000);

function req(url: string, body?: unknown, method = "POST") {
  return new Request(`http://localhost${url}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  auth.getCurrentWorkspaceId.mockResolvedValue("w1");
  access.getCurrentWorkspaceContext.mockResolvedValue(CTX);
});

describe("intervalo do mês", () => {
  it("usa o fuso de São Paulo", () => {
    const { inicio, fim } = mesIntervalo("2026-12");
    expect(inicio.toISOString()).toBe("2026-12-01T03:00:00.000Z");
    expect(fim.toISOString()).toBe("2027-01-01T03:00:00.000Z");
  });
});

describe("rotas de posts", () => {
  it("GET sem sessão responde 401", async () => {
    auth.getCurrentWorkspaceId.mockResolvedValue(null);
    const res = await GET(req("/api/opi/posts?mes=2026-11", undefined, "GET"));
    expect(res.status).toBe(401);
  });

  it("POST sem sessão responde 401", async () => {
    access.getCurrentWorkspaceContext.mockResolvedValue(null);
    const res = await POST(req("/api/opi/posts", {}));
    expect(res.status).toBe(401);
  });

  it("POST de membro sem permissão responde 403", async () => {
    access.getCurrentWorkspaceContext.mockResolvedValue({ ...CTX, role: "MEMBER" });
    const res = await POST(req("/api/opi/posts", {}));
    expect(res.status).toBe(403);
  });

  it("POST cria sempre como RASCUNHO", async () => {
    mockPrisma.postAgendado.create.mockResolvedValue({ id: "p1" });
    const res = await POST(
      req("/api/opi/posts", {
        tipo: "POST",
        midias: ["https://exemplo.com/a.png"],
        legenda: `Oi. ${AVISO_OBRIGATORIO}`,
        agendadoPara: futuro.toISOString(),
        status: "APROVADO",
      }),
    );
    expect(res.status).toBe(201);
    expect(mockPrisma.postAgendado.create.mock.calls[0][0].data.status).toBe("RASCUNHO");
  });

  it("POST recusa carrossel com uma imagem só e URL sem https", async () => {
    const r1 = await POST(
      req("/api/opi/posts", { tipo: "CARROSSEL", midias: ["https://a/1.png"], legenda: "x", agendadoPara: futuro.toISOString() }),
    );
    expect(r1.status).toBe(400);
    const r2 = await POST(
      req("/api/opi/posts", { tipo: "POST", midias: ["http://a/1.png"], legenda: "x", agendadoPara: futuro.toISOString() }),
    );
    expect(r2.status).toBe(400);
    expect(mockPrisma.postAgendado.create).not.toHaveBeenCalled();
  });

  it("PATCH de APROVADO volta para RASCUNHO e limpa a aprovação", async () => {
    mockPrisma.postAgendado.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.postAgendado.findFirst.mockResolvedValue({ id: "p1", status: "RASCUNHO" });
    const res = await PATCH(
      req("/api/opi/posts/p1", {
        tipo: "POST",
        midias: ["https://exemplo.com/a.png"],
        legenda: `Novo. ${AVISO_OBRIGATORIO}`,
        agendadoPara: futuro.toISOString(),
      }, "PATCH"),
      { params: Promise.resolve({ id: "p1" }) },
    );
    expect(res.status).toBe(200);
    const arg = mockPrisma.postAgendado.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: "p1", workspaceId: "w1", status: { in: ["RASCUNHO", "APROVADO", "ERRO"] } });
    expect(arg.data).toMatchObject({ status: "RASCUNHO", aprovadoEm: null, aprovadoPor: null });
  });

  it("PATCH de PUBLICADO responde 409", async () => {
    mockPrisma.postAgendado.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.postAgendado.findFirst.mockResolvedValue({ status: "PUBLICADO" });
    const res = await PATCH(
      req("/api/opi/posts/p1", {
        tipo: "POST",
        midias: ["https://exemplo.com/a.png"],
        legenda: "x",
        agendadoPara: futuro.toISOString(),
      }, "PATCH"),
      { params: Promise.resolve({ id: "p1" }) },
    );
    expect(res.status).toBe(409);
  });
});

describe("aprovar-mes", () => {
  it("sem sessão responde 401", async () => {
    access.getCurrentWorkspaceContext.mockResolvedValue(null);
    const res = await APROVAR(req("/api/opi/posts/aprovar-mes", { mes: "2026-11" }));
    expect(res.status).toBe(401);
  });

  it("422 e nada aprovado quando algum rascunho não tem o aviso", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([
      { id: "ok", legenda: `Bom. ${AVISO_OBRIGATORIO}`, agendadoPara: futuro },
      { id: "ruim", legenda: "Sem aviso", agendadoPara: futuro },
    ]);
    const res = await APROVAR(req("/api/opi/posts/aprovar-mes", { mes: "2026-11" }));
    expect(res.status).toBe(422);
    const dados = await res.json();
    expect(dados.pendencias.map((p: { id: string }) => p.id)).toEqual(["ruim"]);
    expect(mockPrisma.postAgendado.updateMany).not.toHaveBeenCalled();
  });

  it("422 quando um rascunho tem data já passada", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([
      { id: "velho", legenda: AVISO_OBRIGATORIO, agendadoPara: new Date(Date.now() - 60_000) },
    ]);
    const res = await APROVAR(req("/api/opi/posts/aprovar-mes", { mes: "2026-11" }));
    expect(res.status).toBe(422);
    expect(mockPrisma.postAgendado.updateMany).not.toHaveBeenCalled();
  });

  it("aprova todos os rascunhos do mês com aprovadoEm e aprovadoPor", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([
      { id: "a", legenda: `A. ${AVISO_OBRIGATORIO}`, agendadoPara: futuro },
      { id: "b", legenda: `B. ${AVISO_OBRIGATORIO}`, agendadoPara: futuro },
    ]);
    mockPrisma.user.findUnique.mockResolvedValue({ email: "luan@exemplo.com" });
    mockPrisma.postAgendado.updateMany.mockResolvedValue({ count: 2 });
    const res = await APROVAR(req("/api/opi/posts/aprovar-mes", { mes: "2026-11" }));
    expect(res.status).toBe(200);
    expect((await res.json()).aprovados).toBe(2);
    const arg = mockPrisma.postAgendado.updateMany.mock.calls[0][0];
    expect(arg.where).toEqual({ id: { in: ["a", "b"] }, workspaceId: "w1", status: "RASCUNHO" });
    expect(arg.data.status).toBe("APROVADO");
    expect(arg.data.aprovadoPor).toBe("luan@exemplo.com");
    expect(arg.data.aprovadoEm).toBeInstanceOf(Date);
  });
});
