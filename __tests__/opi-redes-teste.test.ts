// Teste real de conexão das redes (só leitura), snapshot gravado, rascunho do Facebook e autor do LinkedIn.
// Nenhuma chamada real: Graph e Composio são um fetch falso.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  redes: { createMany: vi.fn(async () => ({ count: 0 })) },
  posts: { findMany: vi.fn() },
  ctx: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ prisma: { redeSnapshot: state.redes, postAgendado: state.posts } }));
vi.mock("@/lib/workspace-access", () => ({
  getCurrentWorkspaceContext: state.ctx,
  canManageWorkspace: (role: string) => role === "OWNER" || role === "ADMIN",
}));
vi.mock("@/lib/meta/facebook-login", () => ({ resolvePageAccessToken: vi.fn(async (t: string) => t) }));

import { AVISO_OBRIGATORIO } from "@/lib/opi/aviso";
import { COMPOSIO_BASE } from "@/lib/opi/publicadores/composio";
import { publicarReelFacebook } from "@/lib/opi/publicadores/facebook";
import type { PublicarDeps } from "@/lib/opi/publicadores/graph";
import { publicarLinkedin } from "@/lib/opi/publicadores/linkedin";
import { montarRedes } from "@/lib/opi/redes";
import { coletarRedes } from "@/lib/opi/redes-coleta";
import { snapshotDoTeste, testarRede, testarRedes, urnDoLinkedin } from "@/lib/opi/redes-teste";
import { POST as testar } from "../app/api/opi/redes/testar/route";
import { POST as testePublicacao } from "../app/api/opi/redes/teste-publicacao/route";

const TOKEN = "TOKEN-SECRETO-123";
const CHAVE = "ak_CHAVE-SECRETA-999";
const GRAPH = "https://graph.facebook.com/v25.0";
const ENV = {
  COMPOSIO_API_KEY: CHAVE,
  COMPOSIO_USER_ID: "user-1",
  COMPOSIO_YOUTUBE_ACCOUNT_ID: "ca_yt",
  COMPOSIO_LINKEDIN_ACCOUNT_ID: "ca_li",
};

type Chamada = { metodo: string; url: string; headers: Record<string, string>; corpo: string };
type Resposta = { status?: number; body?: unknown } | Error;

function fetchFalso(regras: Array<[string, Resposta | ((c: Chamada) => Resposta)]>) {
  const chamadas: Chamada[] = [];
  const fn = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const c: Chamada = {
      metodo: init?.method ?? "GET",
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      corpo: typeof init?.body === "string" ? init.body : "",
    };
    chamadas.push(c);
    const regra = regras.find(([trecho]) => `${c.metodo} ${c.url}`.includes(trecho));
    const r = regra ? (typeof regra[1] === "function" ? regra[1](c) : regra[1]) : {};
    if (r instanceof Error) throw r;
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fn, chamadas };
}

const graph = (f: typeof fetch, extra: Partial<PublicarDeps> = {}): PublicarDeps => ({
  fetch: f,
  token: TOKEN,
  igUserId: "IG1",
  versao: "v25.0",
  pageId: "PG1",
  ...extra,
});

const composio = (data: unknown) => ({ body: { successful: true, data } });
const CANAL = { items: [{ id: "UC1", snippet: { title: "Luan", customUrl: "@luan.s.cardoso" }, statistics: { subscriberCount: "12", viewCount: "340", videoCount: "3" } }] };
const PERFIL = { id: "9HVNKIMMNZ", localizedFirstName: "Luan ", localizedLastName: "Siqueira Cardoso", vanityName: "luan-s-cardoso" };

const TODAS_OK: Array<[string, Resposta]> = [
  [`GET ${GRAPH}/IG1`, { body: { username: "opcoesparainvestidores", followers_count: 1950, media_count: 41 } }],
  [`GET ${GRAPH}/PG1`, { body: { name: "Opções para Investidores", followers_count: 7, fan_count: 5 } }],
  ["tools/execute/YOUTUBE_LIST_CHANNELS", composio(CANAL)],
  ["tools/execute/LINKEDIN_GET_MY_INFO", composio(PERFIL)],
];

beforeEach(() => {
  vi.clearAllMocks();
  state.ctx.mockResolvedValue({ workspaceId: "ws1", role: "OWNER", userId: "u1" });
});

describe("testarRede: leitura real, uma rede por vez", () => {
  it("Instagram, Facebook, YouTube e LinkedIn respondem com a conta e os números; X sem conta fica 'não ligado'", async () => {
    const f = fetchFalso(TODAS_OK);
    const r = await testarRedes({ fetch: f.fn, graph: graph(f.fn), env: ENV });
    const por = Object.fromEntries(r.map((x) => [x.rede, x]));

    expect(por.instagram).toMatchObject({ ok: true, conta: "@opcoesparainvestidores", metricas: { seguidores: 1950, publicacoes: 41 } });
    expect(por.facebook).toMatchObject({ ok: true, conta: "Opções para Investidores", metricas: { seguidores: 7, curtidas: 5 } });
    expect(por.youtube).toMatchObject({ ok: true, conta: "@luan.s.cardoso", metricas: { inscritos: 12, visualizacoes: 340, publicacoes: 3 } });
    expect(por.linkedin).toMatchObject({ ok: true, conta: "Luan Siqueira Cardoso (luan-s-cardoso)", metricas: { _autor: "urn:li:person:9HVNKIMMNZ" } });
    expect(por.x).toMatchObject({ ok: false, semConfiguracao: true });
    // Só leitura: nenhuma ferramenta de escrita foi chamada.
    expect(f.chamadas.every((c) => c.metodo === "GET" || /YOUTUBE_LIST_CHANNELS|LINKEDIN_GET_MY_INFO/.test(c.url))).toBe(true);
  });

  it("usa a conta conectada de cada rede e o user_id do projeto", async () => {
    const f = fetchFalso(TODAS_OK);
    await testarRede("youtube", { fetch: f.fn, graph: null, env: ENV });
    await testarRede("linkedin", { fetch: f.fn, graph: null, env: ENV });
    const corpos = f.chamadas.map((c) => JSON.parse(c.corpo) as { user_id: string; connected_account_id?: string });
    expect(f.chamadas[0].url).toBe(`${COMPOSIO_BASE}/tools/execute/YOUTUBE_LIST_CHANNELS`);
    expect(f.chamadas[0].headers["x-api-key"]).toBe(CHAVE);
    expect(corpos).toEqual([
      expect.objectContaining({ user_id: "user-1", connected_account_id: "ca_yt" }),
      expect.objectContaining({ user_id: "user-1", connected_account_id: "ca_li" }),
    ]);
  });

  it("falha nunca vaza token nem chave, e nunca lança", async () => {
    const f = fetchFalso([
      [`GET ${GRAPH}/IG1`, { status: 400, body: { error: { message: `Token ${TOKEN} expirado`, code: 190 } } }],
      ["tools/execute/YOUTUBE_LIST_CHANNELS", { status: 401, body: { error: { message: `chave ${CHAVE} recusada` } } }],
      ["tools/execute/LINKEDIN_GET_MY_INFO", new Error("ECONNRESET")],
    ]);
    const r = await testarRedes({ fetch: f.fn, graph: graph(f.fn), env: ENV }, ["instagram", "youtube", "linkedin"]);
    expect(r.map((x) => x.ok)).toEqual([false, false, false]);
    for (const x of r) {
      expect(x.detalhe).not.toContain(TOKEN);
      expect(x.detalhe).not.toContain(CHAVE);
      expect(x.semConfiguracao).toBe(false);
    }
    expect(r[0].detalhe).toContain("190");
  });

  it("sem configuração: Meta ausente e Composio ausente não são falha e não chamam ninguém", async () => {
    const f = fetchFalso([]);
    const r = await testarRedes({ fetch: f.fn, graph: null, env: {} });
    expect(r.every((x) => !x.ok && x.semConfiguracao)).toBe(true);
    expect(f.chamadas).toEqual([]);
  });

  it("canal inexistente e perfil sem id viram falha com motivo", async () => {
    const f = fetchFalso([
      ["YOUTUBE_LIST_CHANNELS", composio({ items: [] })],
      ["LINKEDIN_GET_MY_INFO", composio({ localizedFirstName: "Luan" })],
    ]);
    const yt = await testarRede("youtube", { fetch: f.fn, graph: null, env: ENV });
    const li = await testarRede("linkedin", { fetch: f.fn, graph: null, env: ENV });
    expect(yt).toMatchObject({ ok: false, semConfiguracao: false });
    expect(yt.detalhe).toMatch(/não tem canal/);
    expect(li).toMatchObject({ ok: false, semConfiguracao: false });
  });
});

describe("snapshot do teste e a tela Redes", () => {
  it("sucesso vira 'conectado' com os números e a conta; falha guarda o motivo; não ligado vira 'sem_conta'", () => {
    expect(
      snapshotDoTeste({ rede: "youtube", ok: true, conta: "@c", detalhe: "", metricas: { inscritos: 12, visualizacoes: null }, semConfiguracao: false }),
    ).toEqual({ rede: "youtube", estado: "conectado", metricas: { inscritos: 12, _conta: "@c" } });
    expect(snapshotDoTeste({ rede: "facebook", ok: false, conta: null, detalhe: "Graph 400", metricas: {}, semConfiguracao: false })).toEqual({
      rede: "facebook",
      estado: "sem_dados",
      metricas: { _erro: "Graph 400" },
    });
    expect(snapshotDoTeste({ rede: "x", ok: false, conta: null, detalhe: "não conectado", metricas: {}, semConfiguracao: true }).estado).toBe("sem_conta");
  });

  it("montarRedes esconde as anotações do card e expõe conta e motivo", () => {
    const agora = new Date("2026-11-14T22:00:00Z");
    const redes = montarRedes([
      { rede: "youtube", estado: "conectado", metricas: { inscritos: 12, _conta: "@luan.s.cardoso" }, coletadoEm: agora },
      { rede: "linkedin", estado: "conectado", metricas: { _autor: "urn:li:person:x", _conta: "Luan" }, coletadoEm: agora },
      { rede: "facebook", estado: "sem_dados", metricas: { _erro: "Graph 400 (código 190): token expirado" }, coletadoEm: agora },
    ]);
    const por = Object.fromEntries(redes.map((r) => [r.id, r]));
    expect(por.youtube).toMatchObject({ estado: "conectado", metricas: { inscritos: 12 }, conta: "@luan.s.cardoso", erroTeste: null });
    expect(por.linkedin.metricas).toEqual({});
    expect(por.linkedin.conta).toBe("Luan");
    expect(por.facebook).toMatchObject({ estado: "sem_dados", metricas: {}, conta: null, erroTeste: "Graph 400 (código 190): token expirado" });
    expect(por.tiktok).toMatchObject({ conta: null, erroTeste: null });
  });

  it("coletarRedes grava um snapshot por rede no workspace certo", async () => {
    const f = fetchFalso(TODAS_OK);
    vi.stubEnv("META_PAGE_ACCESS_TOKEN", TOKEN);
    vi.stubEnv("META_PAGE_ID", "PG1");
    vi.stubEnv("META_IG_USER_ID", "IG1");
    vi.stubEnv("META_GRAPH_API_VERSION", "v25.0");
    try {
      const r = await coletarRedes("ws1", { fetch: f.fn, env: ENV, redes: ["instagram", "youtube"] });
      expect(r.map((x) => x.ok)).toEqual([true, true]);
      expect(state.redes.createMany).toHaveBeenCalledTimes(1);
      const { data } = (state.redes.createMany.mock.calls[0] as unknown as [{ data: Array<Record<string, unknown>> }])[0];
      expect(data).toEqual([
        expect.objectContaining({ workspaceId: "ws1", rede: "instagram", estado: "conectado" }),
        expect.objectContaining({ workspaceId: "ws1", rede: "youtube", estado: "conectado" }),
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("rotas do teste", () => {
  const pedido = (url: string, corpo: unknown) =>
    new Request(`https://example.test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo) });

  it("sem sessão 401; sem permissão 403; corpo inválido 400", async () => {
    state.ctx.mockResolvedValueOnce(null);
    expect((await testar(pedido("/api/opi/redes/testar", {}))).status).toBe(401);
    state.ctx.mockResolvedValueOnce({ workspaceId: "ws1", role: "MEMBER", userId: "u" });
    expect((await testar(pedido("/api/opi/redes/testar", {}))).status).toBe(403);
    expect((await testar(pedido("/api/opi/redes/testar", { redes: ["orkut"] }))).status).toBe(400);
    expect((await testar(pedido("/api/opi/redes/testar", { workspaceId: "outro" }))).status).toBe(400);

    state.ctx.mockResolvedValueOnce(null);
    expect((await testePublicacao(pedido("/api/opi/redes/teste-publicacao", { rede: "youtube" }))).status).toBe(401);
    state.ctx.mockResolvedValueOnce({ workspaceId: "ws1", role: "MEMBER", userId: "u" });
    expect((await testePublicacao(pedido("/api/opi/redes/teste-publicacao", { rede: "youtube" }))).status).toBe(403);
    // Instagram, LinkedIn e X não têm envio de teste: não existe modo privado/rascunho por aqui.
    expect((await testePublicacao(pedido("/api/opi/redes/teste-publicacao", { rede: "instagram" }))).status).toBe(400);
    expect(state.posts.findMany).not.toHaveBeenCalled();
  });

  it("envio de teste sem Reel no calendário responde 409 e não chama rede nenhuma", async () => {
    state.posts.findMany.mockResolvedValue([{ id: "p1", midias: [] }]);
    const r = await testePublicacao(pedido("/api/opi/redes/teste-publicacao", { rede: "youtube" }));
    expect(r.status).toBe(409);
    expect(state.posts.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { workspaceId: "ws1", tipo: "REEL" } }));
  });
});

describe("Facebook em rascunho e autor do LinkedIn", () => {
  const post = { id: "p", tipo: "REEL" as const, midias: ["https://exemplo.test/m/v.mp4"], legenda: `Teste.\n\n${AVISO_OBRIGATORIO}` };

  it("estado DRAFT manda video_state=DRAFT, não consulta status nem link, e devolve o id", async () => {
    const f = fetchFalso([
      [`POST ${GRAPH}/PG1/video_reels`, (c) => (c.corpo.includes("upload_phase=start") ? { body: { video_id: "V1", upload_url: "https://rupload.facebook.com/x/V1" } } : { body: { success: true } })],
      ["POST https://rupload.facebook.com", { body: { success: true } }],
    ]);
    const r = await publicarReelFacebook(post, graph(f.fn), { estado: "DRAFT" });
    expect(r).toEqual({ situacao: "publicado", externoId: "V1", permalink: null });
    const fim = f.chamadas.find((c) => c.corpo.includes("upload_phase=finish"));
    expect(fim?.corpo).toContain("video_state=DRAFT");
    expect(fim?.corpo).not.toContain("video_state=PUBLISHED");
    expect(f.chamadas.some((c) => c.metodo === "GET")).toBe(false);
  });

  it("sem opção continua publicando (PUBLISHED): o caminho do calendário não mudou", async () => {
    const f = fetchFalso([
      [`POST ${GRAPH}/PG1/video_reels`, (c) => (c.corpo.includes("upload_phase=start") ? { body: { video_id: "V1", upload_url: "https://rupload.facebook.com/x/V1" } } : { body: { success: true } })],
      ["POST https://rupload.facebook.com", { body: { success: true } }],
      [`GET ${GRAPH}/V1`, (c) => (c.url.includes("permalink_url") ? { body: { permalink_url: "/reel/V1" } } : { body: { status: { video_status: "ready" } } })],
    ]);
    const r = await publicarReelFacebook(post, graph(f.fn, { esperar: async () => {} }));
    expect(r).toMatchObject({ situacao: "publicado", externoId: "V1", permalink: "https://www.facebook.com/reel/V1" });
    expect(f.chamadas.find((c) => c.corpo.includes("upload_phase=finish"))?.corpo).toContain("video_state=PUBLISHED");
  });

  it("LinkedIn sem OPI_LINKEDIN_AUTOR_URN usa o perfil conectado como autor", async () => {
    expect(urnDoLinkedin(PERFIL)).toBe("urn:li:person:9HVNKIMMNZ");
    expect(urnDoLinkedin({ id: "com espaço" })).toBeNull();
    const f = fetchFalso([
      ["LINKEDIN_GET_MY_INFO", composio(PERFIL)],
      ["LINKEDIN_CREATE_LINKED_IN_POST", composio({ id: "urn:li:share:77" })],
    ]);
    const destino = { id: "d", rede: "linkedin", descricao: `Texto próprio.\n\n${AVISO_OBRIGATORIO}`, aprovadoEm: new Date() };
    const r = await publicarLinkedin(post, destino, { fetch: f.fn, env: ENV });
    expect(r).toMatchObject({ situacao: "publicado", externoId: "urn:li:share:77" });
    const envio = f.chamadas.find((c) => c.url.includes("LINKEDIN_CREATE_LINKED_IN_POST"));
    expect(JSON.parse(envio?.corpo ?? "{}")).toMatchObject({ arguments: { author: "urn:li:person:9HVNKIMMNZ" }, connected_account_id: "ca_li" });
  });

  it("LinkedIn sem aprovação não lê perfil nem publica", async () => {
    const f = fetchFalso([]);
    const r = await publicarLinkedin(post, { id: "d", rede: "linkedin", descricao: "x" }, { fetch: f.fn, env: ENV });
    expect(r.situacao).toBe("aguardando");
    expect(f.chamadas).toEqual([]);
  });
});
