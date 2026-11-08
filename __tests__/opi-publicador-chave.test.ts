import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, access } = vi.hoisted(() => ({
  mockPrisma: {
    workspace: { findUnique: vi.fn(), update: vi.fn() },
    instagramAccount: { findFirst: vi.fn() },
    user: { findUnique: vi.fn() },
  },
  access: { getCurrentWorkspaceContext: vi.fn() },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: access.getCurrentWorkspaceContext,
  canManageWorkspace: (role: string) => role === "ADMIN" || role === "OWNER",
}));

import { GET, PATCH } from "@/app/api/opi/publicador/route";

function patch(body: unknown) {
  return new Request("http://localhost/api/opi/publicador", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("/api/opi/publicador (chave da publicação automática)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.getCurrentWorkspaceContext.mockResolvedValue({ userId: "u1", workspaceId: "w1", role: "OWNER" });
    mockPrisma.instagramAccount.findFirst.mockResolvedValue({ id: "acc" });
    mockPrisma.user.findUnique.mockResolvedValue({ name: "Luan", email: "l@x" });
  });

  it("GET mostra desligada por padrão e se a conta que publica está no workspace", async () => {
    mockPrisma.workspace.findUnique.mockResolvedValue({
      opiPublicadorLigado: false,
      opiPublicadorAlteradoEm: null,
      opiPublicadorAlteradoPor: null,
    });
    const corpo = await (await GET()).json();
    expect(corpo).toEqual({ ligado: false, alteradoEm: null, alteradoPor: null, contaConectada: true, podeAlterar: true });
  });

  it("PATCH liga a chave do workspace atual e registra quem ligou", async () => {
    const quando = new Date("2026-11-08T12:00:00Z");
    mockPrisma.workspace.update.mockResolvedValue({
      opiPublicadorLigado: true,
      opiPublicadorAlteradoEm: quando,
      opiPublicadorAlteradoPor: "Luan",
    });
    const res = await PATCH(patch({ ligado: true }));
    expect(res.status).toBe(200);
    expect(mockPrisma.workspace.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "w1" },
        data: expect.objectContaining({ opiPublicadorLigado: true, opiPublicadorAlteradoPor: "Luan" }),
      }),
    );
    expect((await res.json()).ligado).toBe(true);
  });

  it("PATCH recusa valor que não é booleano", async () => {
    const res = await PATCH(patch({ ligado: "sim" }));
    expect(res.status).toBe(400);
    expect(mockPrisma.workspace.update).not.toHaveBeenCalled();
  });

  it("membro comum não muda a chave", async () => {
    access.getCurrentWorkspaceContext.mockResolvedValue({ userId: "u2", workspaceId: "w1", role: "MEMBER" });
    const res = await PATCH(patch({ ligado: true }));
    expect(res.status).toBe(403);
    expect(mockPrisma.workspace.update).not.toHaveBeenCalled();
  });

  it("sem sessão: 401", async () => {
    access.getCurrentWorkspaceContext.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await PATCH(patch({ ligado: true }))).status).toBe(401);
  });
});
