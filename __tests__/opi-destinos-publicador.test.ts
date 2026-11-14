// Publicador por destino: seleção dos destinos, isolamento de falha entre redes, PULADO, aviso obrigatório,
// Composio sem chave e idempotência. Nenhuma chamada real: Graph e Composio são um fetch falso.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockAlertar } = vi.hoisted(() => ({
  mockPrisma: {
    postAgendado: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    postDestino: { upsert: vi.fn(), updateMany: vi.fn(), update: vi.fn() },
    workspace: { findMany: vi.fn() },
    automation: { updateMany: vi.fn() },
  },
  mockAlertar: vi.fn(async () => "enviado"),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/opi/alertas", () => ({ alertarFalha: mockAlertar }));
vi.mock("@/lib/meta/facebook-login", () => ({ resolvePageAccessToken: vi.fn(async (t: string) => t) }));

import { AVISO_OBRIGATORIO } from "@/lib/opi/aviso";
import {
  MAX_TENTATIVAS,
  destinoElegivel,
  destinosPadrao,
  filtroDestinoElegivel,
  resumoDoPost,
} from "@/lib/opi/destinos";
import { rodarPublicador } from "@/lib/opi/publicador";
import { COMPOSIO_BASE, COMPOSIO_NAO_CONFIGURADO, composioConfig, enviarArquivo, executarFerramenta } from "@/lib/opi/publicadores/composio";
import { publicarReelFacebook } from "@/lib/opi/publicadores/facebook";
import { publicarLinkedin } from "@/lib/opi/publicadores/linkedin";
import { PublicadorErro } from "@/lib/opi/publicadores/tipos";
import { publicarX } from "@/lib/opi/publicadores/x";
import { privacidadeYoutube, publicarYoutube, tagsDaDescricao } from "@/lib/opi/publicadores/youtube";

const TOKEN = "TOKEN-SECRETO-123";
const CHAVE = "ak_CHAVE-SECRETA-999";
const LEGENDA = `Texto do Reel.\n\n${AVISO_OBRIGATORIO}\n\n#Opções #B3`;
const AGORA = new Date("2026-11-20T21:00:00Z");
const GRAPH = "https://graph.facebook.com/v25.0";
const ENV_COMPOSIO = { COMPOSIO_API_KEY: CHAVE, COMPOSIO_USER_ID: "user-1", COMPOSIO_YOUTUBE_ACCOUNT_ID: "ca_yt" };

type Chamada = { metodo: string; url: string; headers: Record<string, string>; corpo: string };
type Resposta = { status?: number; body?: unknown; headers?: Record<string, string> } | Error;

/** fetch falso: a primeira regra cujo trecho aparece em "MÉTODO url" responde. Sem regra: 200 {}. */
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
    return new Response(r.body instanceof Uint8Array ? (r.body as unknown as BodyInit) : JSON.stringify(r.body ?? {}), {
      status: r.status ?? 200,
      headers: r.headers,
    });
  });
  return { fn: fn as unknown as typeof fetch, chamadas, urls: () => chamadas.map((c) => `${c.metodo} ${c.url.split("?")[0]}`) };
}

const destino = (rede: string, extra: Record<string, unknown> = {}) => ({
  id: `d-${rede}`,
  postId: "p1",
  rede,
  status: "PENDENTE",
  tentativas: 0,
  titulo: null,
  descricao: null,
  aprovadoEm: null,
  externoId: null,
  permalink: null,
  erro: null,
  ...extra,
});

const reel = (destinos: unknown[], extra: Record<string, unknown> = {}) => ({
  id: "p1",
  workspaceId: "w1",
  tipo: "REEL" as const,
  midias: ["https://cdn.exemplo/v.mp4"],
  legenda: LEGENDA,
  agendadoPara: new Date("2026-11-20T20:59:00Z"),
  status: "APROVADO",
  aprovadoEm: new Date("2026-11-18T12:00:00Z"),
  destinos,
  ...extra,
});

const deps = (f: typeof fetch, env: Record<string, string | undefined> = {}) => ({
  fetch: f,
  token: TOKEN,
  igUserId: "IG1",
  pageId: "PG1",
  versao: "v25.0",
  esperar: async () => {},
  env,
});

/** Regras do Instagram (Reel) e do Facebook (Reel) que dão certo. */
const IG_OK: Array<[string, Resposta]> = [
  [`POST ${GRAPH}/IG1/media_publish`, { body: { id: "ig-media" } }],
  [`POST ${GRAPH}/IG1/media`, { body: { id: "ig-container" } }],
  [`GET ${GRAPH}/ig-container`, { body: { status_code: "FINISHED" } }],
  [`GET ${GRAPH}/ig-media`, { body: { permalink: "https://instagram.com/reel/abc" } }],
];
const FB_OK: Array<[string, Resposta | ((c: Chamada) => Resposta)]> = [
  [
    `POST ${GRAPH}/PG1/video_reels`,
    (c) =>
      c.corpo.includes("upload_phase=start")
        ? { body: { video_id: "fb-video", upload_url: "https://rupload.facebook.com/video-upload/v25.0/fb-video" } }
        : { body: { success: true } },
  ],
  ["POST https://rupload.facebook.com/", { body: { success: true } }],
  [`GET ${GRAPH}/fb-video`, (c) => (c.url.includes("permalink_url") ? { body: { permalink_url: "/reel/fb-video/" } } : { body: { status: { video_status: "ready" } } })],
];

const dadosDoDestino = (id: string) =>
  mockPrisma.postDestino.update.mock.calls.filter((c) => c[0].where.id === id).map((c) => c[0].data);

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  process.env.OPI_PUBLICADOR = "on";
  // Trava do post (por id) passa; a varredura de PUBLICANDO travado não acha nada.
  mockPrisma.postAgendado.updateMany.mockImplementation(async ({ where }: { where: { id?: unknown } }) => ({
    count: typeof where.id === "string" ? 1 : 0,
  }));
  mockPrisma.postAgendado.update.mockResolvedValue({});
  mockPrisma.automation.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.postDestino.update.mockResolvedValue({});
  // Trava do destino (por id, PENDENTE) passa; varreduras em lote não acham nada.
  mockPrisma.postDestino.updateMany.mockImplementation(async ({ where }: { where: { id?: unknown; status?: unknown } }) => ({
    count: typeof where.id === "string" && where.status === "PENDENTE" ? 1 : 0,
  }));
});
afterEach(() => {
  delete process.env.OPI_PUBLICADOR;
  vi.restoreAllMocks();
});

describe("destinos padrão (OPI_DESTINOS_PADRAO)", () => {
  it("sem a variável, o Reel vai só para o Instagram", () => {
    expect(destinosPadrao("REEL", {})).toEqual(["instagram"]);
    expect(destinosPadrao("REEL", { OPI_DESTINOS_PADRAO: "  " })).toEqual(["instagram"]);
  });
  it("aceita instagram, facebook e youtube, na ordem fixa e sem repetir", () => {
    expect(destinosPadrao("REEL", { OPI_DESTINOS_PADRAO: "youtube, Facebook,instagram,youtube" })).toEqual(["instagram", "facebook", "youtube"]);
  });
  it("linkedin, x e rede desconhecida nunca entram sozinhos", () => {
    expect(destinosPadrao("REEL", { OPI_DESTINOS_PADRAO: "instagram,linkedin,x,tiktok,orkut" })).toEqual(["instagram"]);
    expect(destinosPadrao("REEL", { OPI_DESTINOS_PADRAO: "linkedin,x" })).toEqual(["instagram"]);
  });
  it("carrossel e imagem vão só para o Instagram, mesmo com a variável cheia", () => {
    expect(destinosPadrao("CARROSSEL", { OPI_DESTINOS_PADRAO: "instagram,facebook,youtube" })).toEqual(["instagram"]);
    expect(destinosPadrao("POST", { OPI_DESTINOS_PADRAO: "facebook" })).toEqual(["instagram"]);
  });
});

describe("seleção de destinos pendentes", () => {
  it("só PENDENTE entra; PUBLICADO, PUBLICANDO, ERRO e PULADO ficam fora", () => {
    expect(destinoElegivel(destino("instagram"), false)).toBe(true);
    for (const status of ["PUBLICADO", "PUBLICANDO", "ERRO", "PULADO"]) {
      expect(destinoElegivel(destino("instagram", { status }), true)).toBe(false);
    }
  });
  it("respeita o limite de tentativas", () => {
    expect(destinoElegivel(destino("facebook", { tentativas: MAX_TENTATIVAS - 1 }), true)).toBe(true);
    expect(destinoElegivel(destino("facebook", { tentativas: MAX_TENTATIVAS }), true)).toBe(false);
  });
  it("YouTube, LinkedIn e X esperam enquanto o Composio não está configurado", () => {
    expect(destinoElegivel(destino("youtube"), false)).toBe(false);
    expect(destinoElegivel(destino("youtube"), true)).toBe(true);
    expect(destinoElegivel(destino("facebook"), false)).toBe(true);
  });
  it("LinkedIn e X só entram com aprovação própria do destino", () => {
    expect(destinoElegivel(destino("linkedin"), true)).toBe(false);
    expect(destinoElegivel(destino("x"), true)).toBe(false);
    expect(destinoElegivel(destino("linkedin", { aprovadoEm: new Date() }), true)).toBe(true);
    expect(destinoElegivel(destino("x", { aprovadoEm: new Date() }), true)).toBe(true);
  });
  it("o filtro do banco diz a mesma coisa", () => {
    expect(filtroDestinoElegivel(true)).toEqual({
      status: "PENDENTE",
      tentativas: { lt: MAX_TENTATIVAS },
      OR: [{ rede: { notIn: ["linkedin", "x"] } }, { aprovadoEm: { not: null } }],
    });
    expect(filtroDestinoElegivel(false).rede).toEqual({ notIn: ["youtube", "linkedin", "x"] });
  });
  it("a rodada busca só post aprovado, no prazo, com desempate pelo id", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([]);
    await rodarPublicador(AGORA, deps(fetchFalso([]).fn));
    const arg = mockPrisma.postAgendado.findMany.mock.calls[0][0];
    expect(arg.where.aprovadoEm).toEqual({ not: null });
    expect(arg.where.agendadoPara).toEqual({ lte: AGORA });
    expect(arg.orderBy).toEqual([{ agendadoPara: "asc" }, { id: "asc" }]);
    expect(arg.include).toEqual({ destinos: true });
    // Rascunho e post com erro nunca entram.
    expect(JSON.stringify(arg.where)).not.toContain("RASCUNHO");
    expect(JSON.stringify(arg.where.OR.map((o: { status: unknown }) => o.status))).not.toContain("ERRO");
  });
});

describe("resumo do post (PostAgendado.status)", () => {
  it("PUBLICADO quando o Instagram publicou, mesmo com outra rede em erro ou pendente", () => {
    const r = resumoDoPost([
      destino("instagram", { status: "PUBLICADO", externoId: "m1", permalink: "https://instagram.com/reel/1" }),
      destino("facebook", { status: "ERRO", erro: "x" }),
      destino("youtube"),
    ]);
    expect(r).toEqual({ status: "PUBLICADO", mediaId: "m1", permalink: "https://instagram.com/reel/1", erro: null });
  });
  it("ERRO quando o Instagram falhou, mesmo com o Facebook publicado", () => {
    const r = resumoDoPost([destino("instagram", { status: "ERRO", erro: "Graph 400" }), destino("facebook", { status: "PUBLICADO" })]);
    expect(r).toEqual({ status: "ERRO", erro: "Graph 400" });
  });
  it("sem Instagram: aprovado enquanto houver destino por sair, publicado quando saiu", () => {
    expect(resumoDoPost([destino("youtube")])).toEqual({ status: "APROVADO" });
    expect(resumoDoPost([destino("youtube", { status: "PUBLICADO", permalink: "https://youtube.com/shorts/a" })])).toMatchObject({
      status: "PUBLICADO",
      mediaId: null,
    });
    expect(resumoDoPost([destino("facebook", { status: "PULADO" })]).status).toBe("ERRO");
  });
});

describe("isolamento de falha entre redes", () => {
  it("Instagram falha, Facebook publica mesmo assim; um alerta, do Instagram", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([reel([destino("facebook"), destino("instagram")])]);
    const f = fetchFalso([
      [`POST ${GRAPH}/IG1/media`, { status: 400, body: { error: { message: `Vídeo recusado ${TOKEN}`, code: 100 } } }],
      ...FB_OK,
    ]);
    const r = await rodarPublicador(AGORA, deps(f.fn));

    expect(r).toMatchObject({ publicados: 1, erros: 1 });
    // O Instagram é tentado primeiro (ordem fixa das redes), e a falha dele não impede o Facebook.
    expect(f.urls()[0]).toBe(`POST ${GRAPH}/IG1/media`);
    expect(dadosDoDestino("d-instagram")).toEqual([{ status: "ERRO", erro: expect.stringContaining("Vídeo recusado") }]);
    expect(dadosDoDestino("d-instagram")[0].erro).not.toContain(TOKEN);
    expect(dadosDoDestino("d-facebook")[0]).toMatchObject({
      status: "PUBLICADO",
      externoId: "fb-video",
      permalink: "https://www.facebook.com/reel/fb-video/",
      erro: null,
    });
    expect(dadosDoDestino("d-facebook")[0].publicadoEm).toBeInstanceOf(Date);
    // O resumo segue o Instagram.
    expect(mockPrisma.postAgendado.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { status: "ERRO", erro: expect.stringContaining("Vídeo recusado") },
    });
    expect(mockAlertar).toHaveBeenCalledTimes(1);
    expect(mockAlertar.mock.calls[0]).toEqual([
      "post",
      expect.stringContaining("Reel de 20/11"),
      "/dashboard/calendario",
      { chave: "post:p1", workspaceId: "w1" },
    ]);
  });

  it("Instagram publica, Facebook falha: post PUBLICADO e alerta com a chave da rede", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([reel([destino("instagram"), destino("facebook")])]);
    const f = fetchFalso([
      ...IG_OK,
      [
        `POST ${GRAPH}/PG1/video_reels`,
        (c) =>
          c.corpo.includes("upload_phase=start")
            ? { body: { video_id: "fb-video" } }
            : { status: 400, body: { error: { message: "Página sem permissão", code: 200 } } },
      ],
      ["POST https://rupload.facebook.com/", { body: { success: true } }],
    ]);
    const r = await rodarPublicador(AGORA, deps(f.fn));

    expect(r).toMatchObject({ publicados: 1, erros: 1 });
    expect(mockPrisma.postAgendado.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { status: "PUBLICADO", mediaId: "ig-media", permalink: "https://instagram.com/reel/abc", erro: null },
    });
    // Falha no "finish" não é repetível: pode ter saído. Vira ERRO de vez.
    expect(dadosDoDestino("d-facebook")).toEqual([{ status: "ERRO", erro: expect.stringContaining("Página sem permissão") }]);
    expect(mockAlertar).toHaveBeenCalledTimes(1);
    const [, resumo, , opcoes] = mockAlertar.mock.calls[0] as unknown as [string, string, string, { chave: string }];
    expect(resumo).toContain("no Facebook");
    expect(opcoes).toEqual({ chave: "post:p1:facebook", workspaceId: "w1" });
    // A campanha "próximo Reel" foi presa ao Reel do Instagram mesmo com o Facebook falhando.
    expect(mockPrisma.automation.updateMany).toHaveBeenCalled();
  });

  it("falha antes de publicar (início do envio) volta para a fila até o limite de tentativas", async () => {
    const inicioFalha: Array<[string, Resposta]> = [[`POST ${GRAPH}/PG1/video_reels`, { status: 500, body: { error: { message: "Instável" } } }]];
    mockPrisma.postAgendado.findMany.mockResolvedValue([reel([destino("facebook")])]);
    await rodarPublicador(AGORA, deps(fetchFalso(inicioFalha).fn));
    expect(dadosDoDestino("d-facebook")).toEqual([{ status: "PENDENTE", erro: expect.stringContaining("Instável") }]);
    // Sem Instagram no post, ele volta para APROVADO e a próxima rodada tenta de novo.
    expect(mockPrisma.postAgendado.update).toHaveBeenLastCalledWith({ where: { id: "p1" }, data: { status: "APROVADO" } });

    mockPrisma.postDestino.update.mockClear();
    mockPrisma.postAgendado.findMany.mockResolvedValue([reel([destino("facebook", { tentativas: MAX_TENTATIVAS - 1 })])]);
    await rodarPublicador(AGORA, deps(fetchFalso(inicioFalha).fn));
    expect(dadosDoDestino("d-facebook")).toEqual([{ status: "ERRO", erro: expect.stringContaining("Instável") }]);
  });
});

describe("idempotência por destino", () => {
  it("destino já PUBLICADO não é publicado de novo: só a rede que falta é chamada", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([
      reel([destino("instagram", { status: "PUBLICADO", externoId: "ig-antigo" }), destino("facebook")], { status: "PUBLICADO" }),
    ]);
    const f = fetchFalso(FB_OK);
    const r = await rodarPublicador(AGORA, deps(f.fn));

    expect(r.publicados).toBe(1);
    expect(f.chamadas.some((c) => c.url.includes("/IG1/"))).toBe(false);
    expect(dadosDoDestino("d-instagram")).toEqual([]);
    // Post que já estava PUBLICADO não é travado nem regravado (a varredura de travados é a única chamada).
    expect(mockPrisma.postAgendado.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.postAgendado.update).not.toHaveBeenCalled();
  });

  it("post já PUBLICADO com destino instagram pendente: o destino é acertado, nunca publicado de novo", async () => {
    // Caso real: o worker antigo publica entre a migração e a troca do worker, e o destino fica PENDENTE.
    const agendadoPara = new Date("2026-11-20T20:59:00Z");
    mockPrisma.postAgendado.findMany.mockResolvedValue([
      reel([destino("instagram"), destino("facebook")], { status: "PUBLICADO", mediaId: "ig-antigo", permalink: "https://instagram.com/reel/antigo" }),
    ]);
    const f = fetchFalso([...IG_OK, ...FB_OK]);
    const r = await rodarPublicador(AGORA, deps(f.fn));

    expect(f.chamadas.some((c) => c.url.includes("/IG1/"))).toBe(false);
    expect(mockPrisma.postDestino.updateMany).toHaveBeenCalledWith({
      where: { id: "d-instagram", status: "PENDENTE" },
      data: { status: "PUBLICADO", externoId: "ig-antigo", permalink: "https://instagram.com/reel/antigo", erro: null, publicadoEm: agendadoPara },
    });
    // A outra rede segue normalmente.
    expect(r.publicados).toBe(1);
    expect(dadosDoDestino("d-facebook")[0]).toMatchObject({ status: "PUBLICADO" });
  });

  it("trava do destino: se outra rodada já pegou (count 0), não chama a rede", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([reel([destino("instagram")])]);
    mockPrisma.postDestino.updateMany.mockResolvedValue({ count: 0 });
    const f = fetchFalso(IG_OK);
    const r = await rodarPublicador(AGORA, deps(f.fn));
    expect(r).toMatchObject({ publicados: 0, pulados: 1 });
    expect(f.chamadas).toEqual([]);
    expect(mockPrisma.postDestino.updateMany).toHaveBeenCalledWith({
      where: { id: "d-instagram", status: "PENDENTE" },
      data: { status: "PUBLICANDO", erro: null, tentativas: { increment: 1 } },
    });
  });

  it("post reaprovado com o Instagram já publicado só acerta o resumo, sem publicar", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([
      reel([destino("instagram", { status: "PUBLICADO", externoId: "m1", permalink: "https://instagram.com/reel/1" })]),
    ]);
    const f = fetchFalso([]);
    await rodarPublicador(AGORA, deps(f.fn));
    expect(f.chamadas).toEqual([]);
    expect(mockPrisma.postAgendado.updateMany).toHaveBeenLastCalledWith({
      where: { id: "p1", status: "APROVADO" },
      data: { status: "PUBLICADO", mediaId: "m1", permalink: "https://instagram.com/reel/1", erro: null },
    });
  });

  it("post aprovado de novo por script com o Instagram em ERRO: o destino volta para a fila e publica", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([
      reel([destino("instagram", { status: "ERRO", erro: "Graph 400", tentativas: 1 }), destino("facebook", { status: "ERRO", erro: "x" })]),
    ]);
    mockPrisma.postDestino.updateMany.mockImplementation(async ({ where }: { where: { id?: unknown } }) => ({
      count: typeof where.id === "string" ? 1 : 0,
    }));
    const f = fetchFalso(IG_OK);
    const r = await rodarPublicador(AGORA, deps(f.fn));
    expect(mockPrisma.postDestino.updateMany).toHaveBeenCalledWith({
      where: { id: "d-instagram", status: { in: ["ERRO", "PULADO"] } },
      data: { status: "PENDENTE", erro: null, tentativas: 0 },
    });
    expect(r.publicados).toBe(1);
    // O Facebook em ERRO não volta sozinho: só pela tela.
    expect(f.chamadas.some((c) => c.url.includes("video_reels"))).toBe(false);
    expect(mockPrisma.postDestino.updateMany.mock.calls.some((c) => c[0].where.id === "d-facebook")).toBe(false);
  });

  it("destino travado em PUBLICANDO há mais de 30 min vira ERRO e alerta uma vez", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([]);
    mockPrisma.postDestino.updateMany.mockImplementation(async ({ where }: { where: { status?: unknown } }) => ({
      count: where.status === "PUBLICANDO" ? 2 : 0,
    }));
    await rodarPublicador(AGORA, deps(fetchFalso([]).fn));
    const varredura = mockPrisma.postDestino.updateMany.mock.calls[0][0];
    expect(varredura.where).toEqual({ status: "PUBLICANDO", updatedAt: { lt: new Date(AGORA.getTime() - 30 * 60_000) }, post: {} });
    expect(varredura.data.status).toBe("ERRO");
    expect(mockAlertar).toHaveBeenCalledWith("post", expect.stringContaining("2 destino(s)"), "/dashboard/calendario", {
      chave: "destino:interrompido",
    });
  });
});

describe("PULADO para tipo que a rede não recebe", () => {
  it("carrossel com destino facebook: Facebook PULADO sem chamada, Instagram publica", async () => {
    const carrossel = reel([destino("instagram"), destino("facebook")], {
      tipo: "CARROSSEL",
      midias: ["https://cdn.exemplo/1.png", "https://cdn.exemplo/2.png"],
    });
    mockPrisma.postAgendado.findMany.mockResolvedValue([carrossel]);
    const f = fetchFalso([
      [`POST ${GRAPH}/IG1/media_publish`, { body: { id: "ig-media" } }],
      [`POST ${GRAPH}/IG1/media`, { body: { id: "c" } }],
    ]);
    const r = await rodarPublicador(AGORA, deps(f.fn));

    expect(r).toMatchObject({ publicados: 1, erros: 0, pulados: 1 });
    expect(f.chamadas.some((c) => c.url.includes("video_reels"))).toBe(false);
    expect(dadosDoDestino("d-facebook")).toEqual([{ status: "PULADO", erro: expect.stringContaining("só recebe Reel") }]);
    expect(mockAlertar).not.toHaveBeenCalled();
  });

  it("Facebook e YouTube pulam imagem e carrossel; rede sem publicador (tiktok) também é pulada", async () => {
    const f = fetchFalso([]);
    const post = { id: "p", tipo: "POST" as const, midias: ["https://cdn.exemplo/1.png"], legenda: LEGENDA };
    expect(await publicarReelFacebook(post, deps(f.fn))).toMatchObject({ situacao: "pulado" });
    expect(await publicarYoutube(post, destino("youtube", { titulo: "T" }), { fetch: f.fn, env: ENV_COMPOSIO })).toMatchObject({
      situacao: "pulado",
    });
    expect(f.chamadas).toEqual([]);

    mockPrisma.postAgendado.findMany.mockResolvedValue([reel([destino("tiktok")])]);
    await rodarPublicador(AGORA, deps(f.fn));
    expect(dadosDoDestino("d-tiktok")).toEqual([{ status: "PULADO", erro: "Rede sem publicador automático" }]);
  });
});

describe("bloqueio sem o aviso obrigatório", () => {
  it("legenda sem aviso: nenhuma rede é chamada, nenhum destino é travado, post vira ERRO", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([
      reel([destino("instagram"), destino("facebook"), destino("youtube", { titulo: "T" })], { legenda: "Sem aviso aqui" }),
    ]);
    const f = fetchFalso([]);
    const r = await rodarPublicador(AGORA, deps(f.fn, ENV_COMPOSIO));

    expect(r).toMatchObject({ publicados: 0, erros: 1 });
    expect(f.chamadas).toEqual([]);
    expect(mockPrisma.postDestino.updateMany.mock.calls.some((c) => typeof c[0].where.id === "string")).toBe(false);
    expect(mockPrisma.postAgendado.update).toHaveBeenCalledWith({
      where: { id: "p1" },
      data: { status: "ERRO", erro: "Legenda sem o aviso obrigatório. Nada foi publicado." },
    });
    expect(mockAlertar).toHaveBeenCalledTimes(1);
  });

  it("YouTube: descrição própria sem o aviso é barrada antes de qualquer chamada ao Composio", async () => {
    const f = fetchFalso([]);
    const post = { id: "p", tipo: "REEL" as const, midias: ["https://cdn.exemplo/v.mp4"], legenda: LEGENDA };
    const erro = await publicarYoutube(post, destino("youtube", { titulo: "Título", descricao: "Descrição sem aviso" }), {
      fetch: f.fn,
      env: ENV_COMPOSIO,
    }).catch((e: Error) => e);
    expect(erro).toBeInstanceOf(PublicadorErro);
    expect((erro as Error).message).toContain("aviso obrigatório");
    expect(f.chamadas).toEqual([]);
  });

  it("LinkedIn e X: texto sem o aviso é barrado mesmo com o destino aprovado", async () => {
    const f = fetchFalso([]);
    const post = { id: "p", tipo: "REEL" as const, midias: [], legenda: LEGENDA };
    const aprovado = { aprovadoEm: new Date(), descricao: "Texto sem aviso" };
    const env = { ...ENV_COMPOSIO, OPI_LINKEDIN_AUTOR_URN: "urn:li:person:abc" };
    await expect(publicarLinkedin(post, destino("linkedin", aprovado), { fetch: f.fn, env })).rejects.toThrow(/aviso obrigatório/);
    await expect(publicarX(post, destino("x", aprovado), { fetch: f.fn, env })).rejects.toThrow(/aviso obrigatório/);
    expect(f.chamadas).toEqual([]);
  });
});

describe("Composio sem chave", () => {
  it("composioConfig: sem COMPOSIO_API_KEY ou sem COMPOSIO_USER_ID não há configuração", () => {
    expect(composioConfig({})).toBeNull();
    expect(composioConfig({ COMPOSIO_API_KEY: CHAVE })).toBeNull();
    expect(composioConfig({ COMPOSIO_USER_ID: "u" })).toBeNull();
    expect(composioConfig(ENV_COMPOSIO)).toEqual({ apiKey: CHAVE, userId: "user-1", contas: { youtube: "ca_yt", linkedin: undefined, x: undefined } });
  });

  it("YouTube fica PENDENTE com o motivo escrito, sem chamada, sem tentativa gasta e sem alerta; o Instagram publica", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([reel([destino("instagram"), destino("youtube", { titulo: "T" })])]);
    const f = fetchFalso(IG_OK);
    const r = await rodarPublicador(AGORA, deps(f.fn, {}));

    expect(r).toMatchObject({ publicados: 1, erros: 0 });
    expect(f.chamadas.some((c) => c.url.includes("composio"))).toBe(false);
    // O motivo é gravado em lote, uma vez (quem já tem o motivo não é regravado).
    expect(mockPrisma.postDestino.updateMany).toHaveBeenCalledWith({
      where: {
        status: "PENDENTE",
        rede: { in: ["youtube", "linkedin", "x"] },
        OR: [{ erro: null }, { erro: { not: COMPOSIO_NAO_CONFIGURADO } }],
        post: { aprovadoEm: { not: null }, agendadoPara: { lte: AGORA }, status: { in: ["APROVADO", "PUBLICADO"] } },
      },
      data: { erro: "Composio não configurado" },
    });
    // O destino youtube não foi travado nem alterado.
    expect(mockPrisma.postDestino.updateMany.mock.calls.some((c) => c[0].where.id === "d-youtube")).toBe(false);
    expect(dadosDoDestino("d-youtube")).toEqual([]);
    expect(mockAlertar).not.toHaveBeenCalled();
    // O post sai como PUBLICADO pelo Instagram.
    expect(mockPrisma.postAgendado.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PUBLICADO" }) }));
  });

  it("publicadores do Composio devolvem 'aguardando' sem chave, sem tocar a rede", async () => {
    const f = fetchFalso([]);
    const post = { id: "p", tipo: "REEL" as const, midias: ["https://cdn.exemplo/v.mp4"], legenda: LEGENDA };
    const aprovado = { aprovadoEm: new Date(), descricao: LEGENDA };
    const esperado = { situacao: "aguardando", motivo: "Composio não configurado" };
    expect(await publicarYoutube(post, destino("youtube", { titulo: "T" }), { fetch: f.fn, env: {} })).toEqual(esperado);
    expect(await publicarLinkedin(post, destino("linkedin", aprovado), { fetch: f.fn, env: {} })).toEqual(esperado);
    expect(await publicarX(post, destino("x", aprovado), { fetch: f.fn, env: {} })).toEqual(esperado);
    expect(f.chamadas).toEqual([]);
  });

  it("com a chave configurada, a rodada não grava o motivo e inclui o YouTube na busca", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([]);
    await rodarPublicador(AGORA, deps(fetchFalso([]).fn, ENV_COMPOSIO));
    expect(mockPrisma.postDestino.updateMany.mock.calls.some((c) => c[0].data?.erro === COMPOSIO_NAO_CONFIGURADO)).toBe(false);
    expect(JSON.stringify(mockPrisma.postAgendado.findMany.mock.calls[0][0].where)).not.toContain("youtube");
  });
});

describe("LinkedIn e X só com aprovação própria", () => {
  it("destino sem aprovadoEm fica aguardando, mesmo com Composio configurado", async () => {
    const f = fetchFalso([]);
    const post = { id: "p", tipo: "REEL" as const, midias: [], legenda: LEGENDA };
    expect(await publicarLinkedin(post, destino("linkedin", { descricao: LEGENDA }), { fetch: f.fn, env: ENV_COMPOSIO })).toEqual({
      situacao: "aguardando",
      motivo: "LinkedIn só publica destino aprovado",
    });
    expect(await publicarX(post, destino("x", { descricao: LEGENDA }), { fetch: f.fn, env: ENV_COMPOSIO })).toMatchObject({ situacao: "aguardando" });
    expect(f.chamadas).toEqual([]);
  });

  it("na rodada, linkedin sem aprovação nem é travado", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([reel([destino("instagram"), destino("linkedin", { descricao: LEGENDA })])]);
    const f = fetchFalso(IG_OK);
    await rodarPublicador(AGORA, deps(f.fn, ENV_COMPOSIO));
    expect(mockPrisma.postDestino.updateMany.mock.calls.some((c) => c[0].where.id === "d-linkedin")).toBe(false);
    expect(f.chamadas.some((c) => c.url.includes("composio"))).toBe(false);
  });

  it("LinkedIn aprovado publica o texto do destino com o autor do ambiente", async () => {
    const f = fetchFalso([[`POST ${COMPOSIO_BASE}/tools/execute/LINKEDIN_CREATE_LINKED_IN_POST`, { body: { successful: true, error: null, data: { x_restli_id: "urn:li:share:9" } } }]]);
    const post = { id: "p", tipo: "REEL" as const, midias: [], legenda: "legenda do Reel" };
    const r = await publicarLinkedin(post, destino("linkedin", { aprovadoEm: new Date(), descricao: LEGENDA }), {
      fetch: f.fn,
      env: { ...ENV_COMPOSIO, OPI_LINKEDIN_AUTOR_URN: "urn:li:organization:123" },
    });
    expect(r).toMatchObject({ situacao: "publicado", externoId: "urn:li:share:9" });
    expect(JSON.parse(f.chamadas[0].corpo)).toEqual({
      user_id: "user-1",
      arguments: { author: "urn:li:organization:123", commentary: LEGENDA.trim(), visibility: "PUBLIC" },
    });
  });
});

describe("Facebook: Reel da Página", () => {
  it("start, envio por file_url, finish com PUBLISHED e a legenda, status e link", async () => {
    const f = fetchFalso(FB_OK);
    const post = { id: "p", tipo: "REEL" as const, midias: ["https://cdn.exemplo/v.mp4"], legenda: LEGENDA };
    const r = await publicarReelFacebook(post, deps(f.fn));

    expect(r).toEqual({ situacao: "publicado", externoId: "fb-video", permalink: "https://www.facebook.com/reel/fb-video/" });
    expect(f.urls()).toEqual([
      `POST ${GRAPH}/PG1/video_reels`,
      "POST https://rupload.facebook.com/video-upload/v25.0/fb-video",
      `POST ${GRAPH}/PG1/video_reels`,
      `GET ${GRAPH}/fb-video`,
      `GET ${GRAPH}/fb-video`,
    ]);
    expect(Object.fromEntries(new URLSearchParams(f.chamadas[0].corpo))).toEqual({ upload_phase: "start", access_token: TOKEN });
    expect(f.chamadas[1].headers).toEqual({ Authorization: `OAuth ${TOKEN}`, file_url: "https://cdn.exemplo/v.mp4" });
    expect(Object.fromEntries(new URLSearchParams(f.chamadas[2].corpo))).toEqual({
      upload_phase: "finish",
      video_id: "fb-video",
      video_state: "PUBLISHED",
      description: LEGENDA,
      access_token: TOKEN,
    });
  });

  it("falha no envio é repetível e não vaza o token; falha no finish não é repetível", async () => {
    const post = { id: "p", tipo: "REEL" as const, midias: ["https://cdn.exemplo/v.mp4"], legenda: LEGENDA };
    const envio = fetchFalso([
      [`POST ${GRAPH}/PG1/video_reels`, { body: { video_id: "fb-video" } }],
      ["POST https://rupload.facebook.com/", { status: 400, body: { debug_info: { message: `URL inacessível ${TOKEN}` } } }],
    ]);
    const e1 = (await publicarReelFacebook(post, deps(envio.fn)).catch((e: unknown) => e)) as PublicadorErro;
    expect(e1).toBeInstanceOf(PublicadorErro);
    expect(e1.repetivel).toBe(true);
    expect(e1.message).not.toContain(TOKEN);
    expect(envio.urls()).toHaveLength(2); // não chegou ao finish

    const finish = fetchFalso([
      [`POST ${GRAPH}/PG1/video_reels`, (c) => (c.corpo.includes("start") ? { body: { video_id: "fb-video" } } : { status: 500, body: {} })],
      ["POST https://rupload.facebook.com/", { body: { success: true } }],
    ]);
    const e2 = (await publicarReelFacebook(post, deps(finish.fn)).catch((e: unknown) => e)) as PublicadorErro;
    expect(e2.repetivel).toBe(false);
  });
});

describe("Composio: cliente e YouTube", () => {
  const cfg = composioConfig(ENV_COMPOSIO)!;

  it("executarFerramenta: POST no endpoint v3.1 com x-api-key, user_id, conta e arguments", async () => {
    const f = fetchFalso([["tools/execute/", { body: { successful: true, error: null, data: { ok: 1 } } }]]);
    const dados = await executarFerramenta(cfg, "YOUTUBE_UPLOAD_VIDEO", { title: "t" }, { fetch: f.fn, contaId: "ca_yt" });
    expect(dados).toEqual({ ok: 1 });
    expect(f.chamadas[0].url).toBe("https://backend.composio.dev/api/v3.1/tools/execute/YOUTUBE_UPLOAD_VIDEO");
    expect(f.chamadas[0].headers).toEqual({ "Content-Type": "application/json", "x-api-key": CHAVE });
    expect(JSON.parse(f.chamadas[0].corpo)).toEqual({ user_id: "user-1", connected_account_id: "ca_yt", arguments: { title: "t" } });
  });

  it("successful=false ou HTTP de erro viram erro não repetível, sem a chave na mensagem", async () => {
    const recusado = fetchFalso([["tools/execute/", { body: { successful: false, error: `quota ${CHAVE}`, data: {} } }]]);
    const e1 = (await executarFerramenta(cfg, "X", {}, { fetch: recusado.fn }).catch((e: unknown) => e)) as PublicadorErro;
    expect(e1.message).toContain("quota");
    expect(e1.message).not.toContain(CHAVE);
    expect(e1.repetivel).toBe(false);

    const http = fetchFalso([["tools/execute/", { status: 401, body: { error: { message: "Invalid API key" } } }]]);
    await expect(executarFerramenta(cfg, "X", {}, { fetch: http.fn })).rejects.toThrow(/Composio 401: Invalid API key/);
  });

  it("enviarArquivo: pede o endereço com o md5, faz PUT dos bytes e devolve { name, mimetype, s3key }", async () => {
    const f = fetchFalso([
      ["files/upload/request", { body: { id: "f1", key: "proj/youtube/arquivo", new_presigned_url: "https://s3.exemplo/put?assinatura=1", metadata: { storage_backend: "s3" } } }],
      ["PUT https://s3.exemplo/", {}],
    ]);
    const bytes = new TextEncoder().encode("video");
    const r = await enviarArquivo(cfg, { toolkitSlug: "youtube", toolSlug: "YOUTUBE_UPLOAD_VIDEO", nome: "v.mp4", mimetype: "video/mp4", bytes }, f.fn);
    expect(r).toEqual({ name: "v.mp4", mimetype: "video/mp4", s3key: "proj/youtube/arquivo" });
    expect(f.chamadas[0].url).toBe("https://backend.composio.dev/api/v3.1/files/upload/request");
    expect(JSON.parse(f.chamadas[0].corpo)).toEqual({
      toolkit_slug: "youtube",
      tool_slug: "YOUTUBE_UPLOAD_VIDEO",
      filename: "v.mp4",
      mimetype: "video/mp4",
      md5: "421b47ffd946ca083b65cd668c6b17e6", // md5 de "video"
    });
    expect(f.chamadas[1]).toMatchObject({ metodo: "PUT", headers: { "Content-Type": "video/mp4" } });
    // A chave do Composio não vai para o armazenamento.
    expect(JSON.stringify(f.chamadas[1].headers)).not.toContain(CHAVE);
  });

  it("YouTube: baixa o vídeo, envia ao Composio e sobe como Short privado, categoria Educação", async () => {
    const f = fetchFalso([
      ["GET https://cdn.exemplo/v.mp4", { body: new TextEncoder().encode("video"), headers: { "content-type": "video/mp4" } }],
      ["files/upload/request", { body: { key: "k/1", new_presigned_url: "https://s3.exemplo/put", metadata: { storage_backend: "s3" } } }],
      ["PUT https://s3.exemplo/", {}],
      ["tools/execute/YOUTUBE_UPLOAD_VIDEO", { body: { successful: true, error: null, data: { response_data: { id: "yt123" } } } }],
    ]);
    const post = { id: "p", tipo: "REEL" as const, midias: ["https://cdn.exemplo/v.mp4"], legenda: LEGENDA };
    const r = await publicarYoutube(post, destino("youtube", { titulo: " Os 5 números ", descricao: null }), { fetch: f.fn, env: ENV_COMPOSIO });

    expect(r).toEqual({ situacao: "publicado", externoId: "yt123", permalink: "https://www.youtube.com/shorts/yt123" });
    const corpo = JSON.parse(f.chamadas[3].corpo);
    expect(corpo).toEqual({
      user_id: "user-1",
      connected_account_id: "ca_yt",
      arguments: {
        title: "Os 5 números",
        description: LEGENDA, // sem descrição própria, vale a legenda
        tags: ["Opções", "B3"],
        categoryId: "27",
        privacyStatus: "private",
        videoFilePath: { name: "v.mp4", mimetype: "video/mp4", s3key: "k/1" },
      },
    });
  });

  it("YouTube sem título é erro claro, sem chamada; falha no download é repetível", async () => {
    const post = { id: "p", tipo: "REEL" as const, midias: ["https://cdn.exemplo/v.mp4"], legenda: LEGENDA };
    const f = fetchFalso([]);
    await expect(publicarYoutube(post, destino("youtube"), { fetch: f.fn, env: ENV_COMPOSIO })).rejects.toThrow(/YouTube sem título/);
    expect(f.chamadas).toEqual([]);

    const fora = fetchFalso([["GET https://cdn.exemplo/v.mp4", { status: 404 }]]);
    const e = (await publicarYoutube(post, destino("youtube", { titulo: "T" }), { fetch: fora.fn, env: ENV_COMPOSIO }).catch((x: unknown) => x)) as PublicadorErro;
    expect(e.repetivel).toBe(true);
    expect(fora.chamadas.some((c) => c.url.includes("composio"))).toBe(false);
  });

  it("privacidade: private por padrão, e só aceita os valores do YouTube", () => {
    expect(privacidadeYoutube({})).toBe("private");
    expect(privacidadeYoutube({ OPI_YOUTUBE_PRIVACIDADE: "Public" })).toBe("public");
    expect(privacidadeYoutube({ OPI_YOUTUBE_PRIVACIDADE: "unlisted" })).toBe("unlisted");
    expect(privacidadeYoutube({ OPI_YOUTUBE_PRIVACIDADE: "todos" })).toBe("private");
    expect(tagsDaDescricao("a #Opções b #EducaçãoFinanceira #Opções")).toEqual(["Opções", "EducaçãoFinanceira"]);
  });

  it("na rodada, falha do YouTube não derruba Instagram nem Facebook, e a chave não vaza", async () => {
    mockPrisma.postAgendado.findMany.mockResolvedValue([
      reel([destino("instagram"), destino("facebook"), destino("youtube", { titulo: "Título" })]),
    ]);
    const f = fetchFalso([
      ...IG_OK,
      ...FB_OK,
      ["GET https://cdn.exemplo/v.mp4", { body: new TextEncoder().encode("video") }],
      ["files/upload/request", { body: { key: "k/1", new_presigned_url: "https://s3.exemplo/put" } }],
      ["PUT https://s3.exemplo/", {}],
      ["tools/execute/YOUTUBE_UPLOAD_VIDEO", { body: { successful: false, error: `canal não verificado ${CHAVE}`, data: {} } }],
    ]);
    const r = await rodarPublicador(AGORA, deps(f.fn, ENV_COMPOSIO));

    expect(r).toMatchObject({ publicados: 2, erros: 1 });
    expect(dadosDoDestino("d-youtube")).toEqual([{ status: "ERRO", erro: expect.stringContaining("canal não verificado") }]);
    expect(dadosDoDestino("d-youtube")[0].erro).not.toContain(CHAVE);
    expect(JSON.stringify(mockAlertar.mock.calls)).not.toContain(CHAVE);
    expect((mockAlertar.mock.calls[0] as unknown as [string, string, string, { chave: string }])[3].chave).toBe("post:p1:youtube");
    expect(mockPrisma.postAgendado.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "PUBLICADO" }) }));
  });
});
