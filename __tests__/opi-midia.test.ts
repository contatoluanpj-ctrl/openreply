import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  keys: { findUnique: vi.fn(), update: vi.fn() },
  eval: vi.fn(),
  issueSignedToken: vi.fn(),
  presignUrl: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: { serviceKey: state.keys } }));
vi.mock("ioredis", () => ({ default: class { status = "ready"; eval = state.eval; listenerCount() { return 1; } } }));
vi.mock("@vercel/blob", () => ({ issueSignedToken: state.issueSignedToken, presignUrl: state.presignUrl }));

import { POST } from "../app/api/opi/midia/route";
import {
  MIDIA_DIAS,
  MIDIA_NAO_CONFIGURADA,
  MIDIA_VALIDADE_MS,
  caminhoDaMidia,
  emitirEnvioDeMidia,
  extensaoDaMidia,
  lojaDoBlob,
  midiaDoNossoArmazenamento,
  nomeSeguro,
  type SdkBlob,
} from "../lib/opi/midia";

const AGORA = new Date("2026-11-19T15:00:00Z");
const ENV = { BLOB_STORE_ID: "store_AbC123xyz", NEXTAUTH_URL: "https://painel.exemplo" };
const TOKEN_ASSINADO = { delegationToken: "DELEGACAO", clientSigningToken: "SEGREDO-DE-ASSINATURA", validUntil: 0 };
const URL_ASSINADA = "https://vercel.com/api/blob/?pathname=opi&assinatura=abc";

function sdkFalso(): SdkBlob & { issueSignedToken: ReturnType<typeof vi.fn>; presignUrl: ReturnType<typeof vi.fn> } {
  return {
    issueSignedToken: vi.fn(async () => TOKEN_ASSINADO),
    presignUrl: vi.fn(async () => ({ presignedUrl: URL_ASSINADA })),
  };
}
const deps = (sdk: SdkBlob, env: Record<string, string | undefined> = ENV) => ({ sdk, env, agora: () => AGORA, aleatorio: () => "0123456789abcdef" });

describe("mídia: nomes e caminho", () => {
  it("extensão aceita só mp4, png, jpg e jpeg", () => {
    expect(extensaoDaMidia("N02_ANTHROPIC.MP4")).toBe("mp4");
    expect(extensaoDaMidia("post-3.png")).toBe("png");
    expect(extensaoDaMidia("foto.JPEG")).toBe("jpeg");
    for (const ruim of ["video.mov", "pagina.html", "script.js", "sem-extensao", "arquivo.mp4.exe", "imagem.svg"]) {
      expect(extensaoDaMidia(ruim)).toBeNull();
    }
  });

  it("nome seguro tira acento, espaço e barra", () => {
    expect(nomeSeguro("Notícia da Anthropic (IPO).mp4")).toBe("Noticia-da-Anthropic-IPO");
    expect(nomeSeguro("../../etc/passwd.png")).toBe("etc-passwd");
    expect(nomeSeguro("???.png")).toBe("arquivo");
    expect(nomeSeguro(`${"a".repeat(200)}.mp4`)).toHaveLength(60);
  });

  it("caminho fica em opi/AAAA-MM com o trecho aleatório na frente", () => {
    expect(caminhoDaMidia("N02 Anthropic.mp4", AGORA, "0123456789abcdef")).toBe("opi/2026-11/0123456789abcdef-N02-Anthropic.mp4");
    expect(caminhoDaMidia("capa.JPEG", AGORA, "ff")).toBe("opi/2026-11/ff-capa.jpg");
    expect(() => caminhoDaMidia("virus.exe", AGORA, "ff")).toThrow(/não aceito/);
  });

  it("id da loja: sem prefixo e em minúsculas; inválido vira null", () => {
    expect(lojaDoBlob({ BLOB_STORE_ID: "store_AbC123xyz" })).toBe("abc123xyz");
    expect(lojaDoBlob({ BLOB_STORE_ID: "abc123" })).toBe("abc123");
    expect(lojaDoBlob({ BLOB_STORE_ID: "a.b/c" })).toBeNull();
    expect(lojaDoBlob({})).toBeNull();
  });

  it("sem BLOB_STORE_ID, o id da loja sai do token (só o id, nunca o segredo)", () => {
    const env = { BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_AbC123xyz_SEGREDOsegredo123" };
    expect(lojaDoBlob(env)).toBe("abc123xyz");
    expect(midiaDoNossoArmazenamento("https://abc123xyz.public.blob.vercel-storage.com/opi/2026-11/ff-v.mp4", env)).toBe(true);
    expect(midiaDoNossoArmazenamento("https://segredosegredo123.public.blob.vercel-storage.com/opi/v.mp4", env)).toBe(false);
    // BLOB_STORE_ID, quando existe, vale mais que o token.
    expect(lojaDoBlob({ ...env, BLOB_STORE_ID: "store_outra9" })).toBe("outra9");
    for (const ruim of ["vercel_blob_rw_abc", "outro_blob_rw_abc_segredo", "vercel_blob_ro_abc_segredo", "abc", "vercel_blob_rw_a.b_segredo"]) {
      expect(lojaDoBlob({ BLOB_READ_WRITE_TOKEN: ruim }), ruim).toBeNull();
    }
  });
});

describe("mídia: só do nosso armazenamento", () => {
  it("aceita a loja pública deste projeto (pasta opi/) e a pasta /m/ do painel", () => {
    expect(midiaDoNossoArmazenamento("https://abc123xyz.public.blob.vercel-storage.com/opi/2026-11/ff-v.mp4", ENV)).toBe(true);
    expect(midiaDoNossoArmazenamento("https://painel.exemplo/m/00d3c1a0078dc6c16481ab92.mp4", ENV)).toBe(true);
    expect(midiaDoNossoArmazenamento("https://painel.exemplo/m/li/trava-de-baixa.png", ENV)).toBe(true);
  });

  it("recusa outra loja, outro domínio, http, porta, usuário na URL e caminho fora das pastas", () => {
    for (const url of [
      "https://outraloja.public.blob.vercel-storage.com/opi/2026-11/ff-v.mp4",
      "https://abc123xyz.public.blob.vercel-storage.com/outra-pasta/v.mp4",
      "https://abc123xyz.public.blob.vercel-storage.com.malicioso.com/opi/v.mp4",
      "https://abc123xyz.private.blob.vercel-storage.com/opi/v.mp4",
      "http://abc123xyz.public.blob.vercel-storage.com/opi/v.mp4",
      "https://abc123xyz.public.blob.vercel-storage.com:8443/opi/v.mp4",
      "https://usuario@painel.exemplo/m/v.mp4",
      "https://painel.exemplo/api/qualquer",
      "https://painel.exemplo/m/../api/segredo",
      "https://painel.exemplo.malicioso.com/m/v.mp4",
      "https://cdn.qualquer.com/v.mp4",
      "não é url",
    ]) {
      expect(midiaDoNossoArmazenamento(url, ENV), url).toBe(false);
    }
  });

  it("sem id da loja e sem endereço do painel, nada é aceito", () => {
    expect(midiaDoNossoArmazenamento("https://abc123xyz.public.blob.vercel-storage.com/opi/v.mp4", {})).toBe(false);
    expect(midiaDoNossoArmazenamento("https://painel.exemplo/m/v.mp4", {})).toBe(false);
  });
});

describe("emitirEnvioDeMidia", () => {
  it("assina um PUT preso ao caminho, ao tipo e ao tamanho pedidos, com prazo e apagamento automático", async () => {
    const sdk = sdkFalso();
    const r = await emitirEnvioDeMidia({ nome: "N02 Anthropic.mp4", tamanho: 41_000_000 }, deps(sdk));
    const pathname = "opi/2026-11/0123456789abcdef-N02-Anthropic.mp4";
    const validUntil = AGORA.getTime() + MIDIA_VALIDADE_MS;
    expect(sdk.issueSignedToken).toHaveBeenCalledWith({
      pathname,
      operations: ["put"],
      allowedContentTypes: ["video/mp4"],
      maximumSizeInBytes: 41_000_000,
      validUntil,
    });
    expect(sdk.presignUrl).toHaveBeenCalledWith(TOKEN_ASSINADO, {
      operation: "put",
      pathname,
      access: "public",
      allowedContentTypes: ["video/mp4"],
      maximumSizeInBytes: 41_000_000,
      validUntil,
      addRandomSuffix: false,
      allowOverwrite: false,
      ttlDays: MIDIA_DIAS,
    });
    expect(r).toEqual({
      uploadUrl: URL_ASSINADA,
      metodo: "PUT",
      contentType: "video/mp4",
      pathname,
      urlPublica: `https://abc123xyz.public.blob.vercel-storage.com/${pathname}`,
      expiraEm: new Date(validUntil).toISOString(),
      apagaEmDias: MIDIA_DIAS,
    });
    // O segredo de assinatura nunca vai na resposta.
    expect(JSON.stringify(r)).not.toContain("SEGREDO-DE-ASSINATURA");
    expect(midiaDoNossoArmazenamento(r.urlPublica!, ENV)).toBe(true);
  });

  it("recusa tipo não aceito e arquivo acima do limite, sem chamar o armazenamento", async () => {
    const sdk = sdkFalso();
    await expect(emitirEnvioDeMidia({ nome: "video.mov", tamanho: 10 }, deps(sdk))).rejects.toMatchObject({ status: 400 });
    await expect(emitirEnvioDeMidia({ nome: "video.mp4", tamanho: 300 * 1024 * 1024 + 1 }, deps(sdk))).rejects.toMatchObject({ status: 413 });
    await expect(emitirEnvioDeMidia({ nome: "imagem.png", tamanho: 8 * 1024 * 1024 + 1 }, deps(sdk))).rejects.toMatchObject({ status: 413 });
    expect(sdk.issueSignedToken).not.toHaveBeenCalled();
  });

  it("sem armazenamento configurado responde 503 e não chama nada", async () => {
    const sdk = sdkFalso();
    await expect(emitirEnvioDeMidia({ nome: "v.mp4", tamanho: 10 }, deps(sdk, {}))).rejects.toMatchObject({ status: 503, message: MIDIA_NAO_CONFIGURADA });
    expect(sdk.issueSignedToken).not.toHaveBeenCalled();
  });

  it("endereço que não é https é recusado", async () => {
    const sdk = sdkFalso();
    sdk.presignUrl.mockResolvedValue({ presignedUrl: "http://inseguro/put" });
    await expect(emitirEnvioDeMidia({ nome: "v.mp4", tamanho: 10 }, deps(sdk))).rejects.toMatchObject({ status: 502 });
  });
});

describe("POST /api/opi/midia", () => {
  const token = `orp_${"c".repeat(43)}`;
  const key = (scopes: string[]) => ({ id: "key", workspaceId: "w1", scopes, expiresAt: new Date("2099-01-01"), revokedAt: null });
  const post = (body: unknown, headers: Record<string, string> = { authorization: `Bearer ${token}` }) =>
    POST(new Request("https://painel.exemplo/api/opi/midia", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("REDIS_URL", "redis://localhost:6379");
    vi.stubEnv("NEXTAUTH_URL", "https://painel.exemplo");
    vi.stubEnv("BLOB_STORE_ID", "store_AbC123xyz");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    state.keys.findUnique.mockResolvedValue(key(["midia:write"]));
    state.keys.update.mockResolvedValue({});
    state.eval.mockResolvedValue(1);
    state.issueSignedToken.mockResolvedValue(TOKEN_ASSINADO);
    state.presignUrl.mockResolvedValue({ presignedUrl: URL_ASSINADA });
  });

  it("401 sem chave e 403 sem o escopo midia:write; nada é assinado", async () => {
    expect((await post({ nome: "v.mp4", tamanho: 10 }, {})).status).toBe(401);
    state.keys.findUnique.mockResolvedValue(key(["redes:write", "agentes:rw"]));
    expect((await post({ nome: "v.mp4", tamanho: 10 })).status).toBe(403);
    expect(state.issueSignedToken).not.toHaveBeenCalled();
  });

  it("201 com o endereço de envio; a resposta não traz o segredo de assinatura", async () => {
    const res = await post({ nome: "N02.mp4", tamanho: 1000 });
    expect(res.status).toBe(201);
    const corpo = await res.text();
    expect(JSON.parse(corpo).data).toMatchObject({ uploadUrl: URL_ASSINADA, metodo: "PUT", contentType: "video/mp4", apagaEmDias: MIDIA_DIAS });
    expect(corpo).not.toContain("SEGREDO-DE-ASSINATURA");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("400 com corpo errado ou campo a mais; 413 acima do limite", async () => {
    for (const corpo of [{}, { nome: "v.mp4" }, { nome: "v.mp4", tamanho: -1 }, { nome: "v.mp4", tamanho: 1.5 }, { nome: "v.mp4", tamanho: 10, pathname: "outra/pasta.mp4" }, { nome: "v.exe", tamanho: 10 }]) {
      expect((await post(corpo)).status, JSON.stringify(corpo)).toBe(400);
    }
    expect((await post({ nome: "v.mp4", tamanho: 400 * 1024 * 1024 })).status).toBe(413);
    expect(state.issueSignedToken).not.toHaveBeenCalled();
  });

  it("503 sem armazenamento, e erro do SDK não vaza detalhe", async () => {
    vi.stubEnv("BLOB_STORE_ID", "");
    const sem = await post({ nome: "v.mp4", tamanho: 10 });
    expect(sem.status).toBe(503);
    expect((await sem.json()).error).toBe(MIDIA_NAO_CONFIGURADA);

    vi.stubEnv("BLOB_STORE_ID", "store_AbC123xyz");
    state.issueSignedToken.mockRejectedValue(new Error("token vercel_blob_rw_SEGREDO inválido para store_AbC123xyz"));
    const erro = await post({ nome: "v.mp4", tamanho: 10 });
    expect(erro.status).toBe(503);
    expect(await erro.text()).not.toMatch(/SEGREDO|store_/);
  });
});
