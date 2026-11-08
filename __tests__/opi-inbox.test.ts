import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Caixa de entrada nos dois modos de login, com a Graph mockada (fetch) e o banco mockado.
const { mockPrisma, auth } = vi.hoisted(() => ({
  mockPrisma: {
    instagramAccount: { findFirst: vi.fn() },
    zernioConnection: { findUnique: vi.fn() },
  },
  auth: { getCurrentWorkspaceId: vi.fn() },
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth", () => auth);
// O token salvo no banco é cifrado; aqui ele "abre" sem a chave, a não ser que o teste diga o contrário.
const decrypt = vi.hoisted(() => vi.fn((t: string) => t));
vi.mock("@/lib/meta/oauth", () => ({ decryptToken: decrypt, encryptToken: (t: string) => t }));

import { GET as LISTAR, POST as ENVIAR } from "@/app/api/instagram/conversations/route";
import { GET as ABRIR } from "@/app/api/instagram/conversations/[id]/route";
import { erroInbox, montarConversas, montarMensagens } from "@/lib/instagram/inbox";
import { MetaApiError, PermissionError, RateLimitError, TokenExpiredError } from "@/lib/meta/client";

const TOKEN = "TOKEN-DA-PAGINA-SECRETO";
const CONTA = {
  id: "acc1",
  workspaceId: "w1",
  instagramId: "IG1",
  username: "opcoesparainvestidores",
  provider: "META" as const,
  zernioAccountId: null,
  accessToken: TOKEN,
};

const fetchMock = vi.fn();
function responde(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}
const urlDa = (i = 0) => new URL(String(fetchMock.mock.calls[i][0]));

const CONVERSAS_GRAPH = {
  data: [
    {
      id: "conv-antiga",
      updated_time: "2026-11-07T10:00:00+0000",
      participants: { data: [{ id: "IG1", username: "opcoesparainvestidores" }, { id: "IGSID-2", username: "bia" }] },
      messages: { data: [{ id: "m9", message: "obrigado!", from: { id: "IGSID-2" }, created_time: "2026-11-07T10:00:00+0000" }] },
    },
    {
      id: "conv-nova",
      updated_time: "2026-11-08T12:00:00+0000",
      participants: { data: [{ id: "IG1", username: "opcoesparainvestidores" }, { id: "IGSID-1", username: "joao" }] },
      messages: { data: [{ id: "m2", message: "Te mandei o material", from: { id: "IG1" }, created_time: "2026-11-08T12:00:00+0000" }] },
    },
  ],
};

function req(url: string, init?: RequestInit) {
  return new NextRequest(new URL(url, "http://localhost"), init as ConstructorParameters<typeof NextRequest>[1]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
  auth.getCurrentWorkspaceId.mockResolvedValue("w1");
  mockPrisma.instagramAccount.findFirst.mockResolvedValue(CONTA);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Caixa de entrada com Login do Facebook (META_LOGIN=facebook)", () => {
  beforeEach(() => {
    vi.stubEnv("META_LOGIN", "facebook");
    vi.stubEnv("META_PAGE_ID", "PAGE1");
    vi.stubEnv("META_IG_USER_ID", "IG1");
  });

  it("lista as conversas pela Página em graph.facebook.com, platform=instagram, com o token salvo", async () => {
    responde(CONVERSAS_GRAPH);
    const res = await LISTAR(req("/api/instagram/conversations?instagramAccountId=acc1"));
    const corpo = await res.json();

    expect(res.status).toBe(200);
    expect(urlDa().host).toBe("graph.facebook.com");
    expect(urlDa().pathname).toBe("/v25.0/PAGE1/conversations");
    expect(urlDa().searchParams.get("platform")).toBe("instagram");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(corpo.data.modo).toBe("facebook");
    // Mais recente primeiro, contato é quem não é a conta, "Você:" quando a última veio da conta.
    expect(corpo.data.conversations.map((c: { id: string }) => c.id)).toEqual(["conv-nova", "conv-antiga"]);
    expect(corpo.data.conversations[0].contact).toEqual({ id: "IGSID-1", username: "joao" });
    expect(corpo.data.conversations[0].lastMessage.fromMe).toBe(true);
    expect(corpo.data.conversations[1].lastMessage.fromMe).toBe(false);
  });

  it("abre a conversa em /{conversation-id}?fields=messages{...} e devolve em ordem cronológica", async () => {
    responde({
      messages: {
        data: [
          { id: "b", message: "segunda", from: { id: "IG1" }, created_time: "2026-11-08T12:01:00+0000" },
          { id: "a", message: "primeira", from: { id: "IGSID-1", username: "joao" }, created_time: "2026-11-08T12:00:00+0000" },
        ],
      },
    });
    const res = await ABRIR(req("/api/instagram/conversations/conv-nova?instagramAccountId=acc1"), {
      params: Promise.resolve({ id: "conv-nova" }),
    });
    const corpo = await res.json();
    expect(urlDa().host).toBe("graph.facebook.com");
    expect(urlDa().pathname).toBe("/v25.0/conv-nova");
    expect(urlDa().searchParams.get("fields")).toContain("messages{");
    expect(corpo.data.messages.map((m: { text: string }) => m.text)).toEqual(["primeira", "segunda"]);
    expect(corpo.data.messages[1].fromMe).toBe(true);
    expect(corpo.data.messages[0].fromUsername).toBe("joao");
  });

  it("envia a resposta pela Página (/{page-id}/messages)", async () => {
    responde({ recipient_id: "IGSID-1", message_id: "mid" });
    const res = await ENVIAR(
      req("/api/instagram/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagramAccountId: "acc1", recipientId: "IGSID-1", text: "Oi!" }),
      })
    );
    expect(res.status).toBe(200);
    expect(urlDa().pathname).toBe("/v25.0/PAGE1/messages");
  });

  it("token vencido vira mensagem em português, com código, sem o token", async () => {
    responde({ error: { code: 190, message: `Error validating access token: ${TOKEN}`, type: "OAuthException" } }, 400);
    const res = await LISTAR(req("/api/instagram/conversations"));
    const corpo = await res.json();
    expect(res.status).toBe(401);
    expect(corpo.success).toBe(false);
    expect(corpo.codigo).toBe("token");
    expect(corpo.error).toMatch(/expirou/);
    expect(JSON.stringify(corpo)).not.toContain(TOKEN);
  });

  it("permissão negada explica o que conferir", async () => {
    responde({ error: { code: 200, message: "Requires pages_messaging permission" } }, 403);
    const corpo = await (await LISTAR(req("/api/instagram/conversations"))).json();
    expect(corpo.codigo).toBe("permissao");
    expect(corpo.error).toMatch(/instagram_manage_messages/);
  });

  it("META_PAGE_ID ausente vira erro de configuração claro", async () => {
    vi.stubEnv("META_PAGE_ID", "");
    const corpo = await (await LISTAR(req("/api/instagram/conversations"))).json();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(corpo.codigo).toBe("config");
    expect(corpo.error).toContain("META_PAGE_ID");
  });
});

describe("Caixa de entrada com Login do Instagram (padrão)", () => {
  beforeEach(() => vi.stubEnv("META_LOGIN", ""));

  it("lista as conversas em graph.instagram.com/{ig-user-id}/conversations", async () => {
    responde(CONVERSAS_GRAPH);
    const res = await LISTAR(req("/api/instagram/conversations"));
    const corpo = await res.json();
    expect(urlDa().host).toBe("graph.instagram.com");
    expect(urlDa().pathname).toBe("/v25.0/IG1/conversations");
    expect(corpo.data.modo).toBe("instagram");
    expect(corpo.data.conversations).toHaveLength(2);
  });

  it("abre a conversa em graph.instagram.com", async () => {
    responde({ messages: { data: [] } });
    const res = await ABRIR(req("/api/instagram/conversations/c1"), { params: Promise.resolve({ id: "c1" }) });
    expect(urlDa().host).toBe("graph.instagram.com");
    expect((await res.json()).data.messages).toEqual([]);
  });
});

describe("estados sem chamada à Meta", () => {
  it("sem conta conectada: 404 com código sem_conta e texto em português", async () => {
    mockPrisma.instagramAccount.findFirst.mockResolvedValue(null);
    const res = await LISTAR(req("/api/instagram/conversations"));
    const corpo = await res.json();
    expect(res.status).toBe(404);
    expect(corpo.codigo).toBe("sem_conta");
    expect(corpo.error).toMatch(/Nenhuma conta do Instagram/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem sessão: 401", async () => {
    auth.getCurrentWorkspaceId.mockResolvedValue(null);
    const res = await LISTAR(req("/api/instagram/conversations"));
    expect(res.status).toBe(401);
  });

  it("token salvo que não abre (chave de criptografia) vira token_local", async () => {
    decrypt.mockImplementationOnce(() => {
      throw new Error("ENCRYPTION_KEY environment variable is required");
    });
    const corpo = await (await LISTAR(req("/api/instagram/conversations"))).json();
    expect(corpo.codigo).toBe("token_local");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("erroInbox e montagem", () => {
  it("classifica os erros da Meta", () => {
    expect(erroInbox(new TokenExpiredError("x")).codigo).toBe("token");
    expect(erroInbox(new RateLimitError("x")).codigo).toBe("limite");
    expect(erroInbox(new PermissionError("x")).codigo).toBe("permissao");
    expect(erroInbox(new MetaApiError(2, undefined, undefined, "falhou access_token=abc123")).mensagem).not.toContain("abc123");
    const tempo = new Error("timeout");
    tempo.name = "TimeoutError";
    expect(erroInbox(tempo).codigo).toBe("tempo");
    expect(erroInbox(new Error("qualquer")).codigo).toBe("desconhecido");
  });

  it("conversa sem participantes nem mensagens não quebra a tela", () => {
    expect(montarConversas([{ id: "x" }], "IG1")).toEqual([
      { id: "x", detailsUnavailable: undefined, contact: { id: "", username: null }, updatedTime: null, lastMessage: null },
    ]);
    expect(montarMensagens([{ id: "m" }], "IG1")[0]).toMatchObject({ text: "", fromMe: false });
  });
});
