// Confere que os pontos de falha chamam alertarFalha (o envio em si é testado em opi-alertas.test.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockAlertar, mockRefresh } = vi.hoisted(() => ({
  mockPrisma: {
    postAgendado: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    // Destinos: sem `destinos` no post, o publicador cria o do Instagram (upsert). A trava do destino
    // (PENDENTE -> PUBLICANDO, por id) passa; as varreduras em lote não acham nada.
    postDestino: {
      upsert: vi.fn(async ({ create }: { create: { postId: string; rede: string } }) => ({
        id: `d-${create.postId}`, postId: create.postId, rede: create.rede, status: "PENDENTE", tentativas: 0,
        titulo: null, descricao: null, aprovadoEm: null, externoId: null, permalink: null, erro: null,
      })),
      updateMany: vi.fn(async ({ where }: { where: { id?: unknown; status?: unknown } }) => ({
        count: typeof where.id === "string" && where.status === "PENDENTE" ? 1 : 0,
      })),
      update: vi.fn(async () => ({})),
    },
    workspace: { findMany: vi.fn(), updateMany: vi.fn() },
    automation: { updateMany: vi.fn() },
    instagramAccount: { findMany: vi.fn(), update: vi.fn() },
    operationalEvent: { create: vi.fn() },
  },
  mockAlertar: vi.fn(async () => "enviado"),
  mockRefresh: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/opi/alertas", () => ({ alertarFalha: mockAlertar }));
vi.mock("@/lib/meta/facebook-login", () => ({ resolvePageAccessToken: vi.fn(async (t: string) => t) }));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: (t: string) => t, encryptToken: (t: string) => t }));
vi.mock("@/lib/meta/client", () => ({ refreshLongLivedToken: mockRefresh }));

import { NextRequest } from "next/server";
import { GET as refreshTokens } from "@/app/api/cron/refresh-tokens/route";
import { AVISO_OBRIGATORIO } from "@/lib/opi/aviso";
import { rodarPublicador } from "@/lib/opi/publicador";

const AGORA = new Date("2026-11-12T21:00:30.000Z");
const post = (legenda: string) => ({
  id: "p1",
  workspaceId: "w1",
  tipo: "POST",
  midias: ["https://cdn.exemplo/a.png"],
  legenda,
  agendadoPara: new Date("2026-11-12T21:00:00.000Z"),
  status: "APROVADO",
  aprovadoEm: new Date("2026-11-10T12:00:00.000Z"),
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.OPI_PUBLICADOR = "on";
  mockPrisma.postAgendado.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.postAgendado.update.mockResolvedValue({});
  mockPrisma.operationalEvent.create.mockResolvedValue({});
  mockPrisma.workspace.updateMany.mockResolvedValue({ count: 0 });
});

describe("publicador avisa quando o post não sai", () => {
  const deps = (f: typeof fetch) => ({ fetch: f, token: "TOKEN-SECRETO", igUserId: "IG1", versao: "v25.0", esperar: async () => {} });

  it("erro da Graph: alerta com a chave do post, link do calendário e sem o token", async () => {
    mockPrisma.postAgendado.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 });
    mockPrisma.postAgendado.findMany.mockResolvedValue([post(`Texto.\n\n${AVISO_OBRIGATORIO}`)]);
    const graph = vi.fn(async () => new Response(JSON.stringify({ error: { message: "Mídia recusada TOKEN-SECRETO", code: 100 } }), { status: 400 }));

    const r = await rodarPublicador(AGORA, deps(graph as unknown as typeof fetch));

    expect(r.erros).toBe(1);
    expect(mockAlertar).toHaveBeenCalledTimes(1);
    const [tipo, resumo, link, opcoes] = mockAlertar.mock.calls[0] as unknown as [string, string, string, { chave: string; workspaceId: string }];
    expect(tipo).toBe("post");
    expect(resumo).toContain("Post de 12/11");
    expect(resumo).toContain("Mídia recusada");
    expect(resumo).not.toContain("TOKEN-SECRETO");
    expect(link).toBe("/dashboard/calendario");
    expect(opcoes).toEqual({ chave: "post:p1", workspaceId: "w1" });
  });

  it("legenda sem o aviso obrigatório também alerta; post publicado não alerta", async () => {
    mockPrisma.postAgendado.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 });
    mockPrisma.postAgendado.findMany.mockResolvedValue([post("Sem aviso")]);
    await rodarPublicador(AGORA, deps(vi.fn() as unknown as typeof fetch));
    expect(mockAlertar).toHaveBeenCalledTimes(1);
    expect((mockAlertar.mock.calls[0] as unknown as [string, string])[1]).toContain("sem o aviso obrigatório");

    mockAlertar.mockClear();
    mockPrisma.postAgendado.updateMany.mockReset();
    mockPrisma.postAgendado.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValue({ count: 1 });
    mockPrisma.postAgendado.findMany.mockResolvedValue([post(`Texto.\n\n${AVISO_OBRIGATORIO}`)]);
    const ok = vi.fn(async () => new Response(JSON.stringify({ id: "m1", permalink: "https://instagram.com/p/x" }), { status: 200 }));
    const r = await rodarPublicador(AGORA, deps(ok as unknown as typeof fetch));
    expect(r.publicados).toBe(1);
    expect(mockAlertar).not.toHaveBeenCalled();
  });

  it("publicação interrompida (travada em PUBLICANDO) alerta uma vez por rodada", async () => {
    mockPrisma.postAgendado.updateMany.mockResolvedValueOnce({ count: 2 });
    mockPrisma.postAgendado.findMany.mockResolvedValue([]);
    await rodarPublicador(AGORA, deps(vi.fn() as unknown as typeof fetch));
    expect(mockAlertar).toHaveBeenCalledWith("post", expect.stringContaining("2 post(s)"), "/dashboard/calendario", { chave: "post:interrompido" });
  });
});

describe("cron de renovação do token avisa quando falha", () => {
  const pedido = () => new NextRequest("http://localhost/api/cron/refresh-tokens", { headers: { authorization: "Bearer segredo-cron" } });

  it("falha na renovação: grava o evento e alerta com a chave da conta", async () => {
    process.env.CRON_SECRET = "segredo-cron";
    mockPrisma.instagramAccount.findMany.mockResolvedValue([{ id: "ig1", workspaceId: "w1", username: "opi", accessToken: "t" }]);
    mockRefresh.mockRejectedValue(new Error("token expirado"));

    const res = await refreshTokens(pedido());

    expect(res.status).toBe(200);
    expect(mockPrisma.operationalEvent.create).toHaveBeenCalledTimes(1);
    expect(mockAlertar).toHaveBeenCalledWith("token", expect.stringContaining("@opi"), "/settings", { chave: "token:ig1", workspaceId: "w1" });
  });

  it("renovação que deu certo não alerta", async () => {
    process.env.CRON_SECRET = "segredo-cron";
    mockPrisma.instagramAccount.findMany.mockResolvedValue([{ id: "ig1", workspaceId: "w1", username: "opi", accessToken: "t" }]);
    mockPrisma.instagramAccount.update.mockResolvedValue({});
    mockRefresh.mockResolvedValue({ accessToken: "novo", expiresIn: 5_000_000 });
    await refreshTokens(pedido());
    expect(mockAlertar).not.toHaveBeenCalled();
  });
});
