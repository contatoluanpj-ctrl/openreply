import { composioConfig, executarFerramenta, semChave, type ComposioConfig } from "@/lib/opi/publicadores/composio";
import { chamarGraph, semToken, type PublicarDeps } from "@/lib/opi/publicadores/graph";
import type { RedeId } from "@/lib/opi/redes";

/**
 * Teste REAL de conexão de cada rede (só leitura: nada é publicado).
 *
 * "Conectado" no painel passa a significar: uma chamada de leitura feita agora, com a credencial
 * que o publicador usa, respondeu com a conta certa. O resultado vira um RedeSnapshot (estado
 * "conectado" + números), então o card da rede e o coletor diário usam o mesmo caminho.
 *
 * Chaves reservadas dentro de `metricas` (começam com "_", não aparecem como número no card):
 *   _conta   nome ou @ da conta que respondeu
 *   _erro    motivo legível quando o teste falhou
 *   _autor   (LinkedIn) URN do autor, usado pelo publicador quando OPI_LINKEDIN_AUTOR_URN não existe
 */

export const REDES_TESTAVEIS = ["instagram", "facebook", "youtube", "linkedin", "x", "threads"] as const;
export type RedeTestavel = (typeof REDES_TESTAVEIS)[number];

export type ResultadoTeste = {
  rede: RedeTestavel;
  ok: boolean;
  /** Nome ou @ da conta que respondeu. null quando o teste falhou antes de saber. */
  conta: string | null;
  /** Frase curta para a tela: o que respondeu, ou por que falhou. */
  detalhe: string;
  /** Números lidos da rede (seguidores, inscritos, publicações…). */
  metricas: Record<string, number | string | null>;
  /** true quando a rede simplesmente não está configurada (não é falha: não alerta). */
  semConfiguracao: boolean;
};

export type DepsTeste = {
  fetch: typeof fetch;
  /** Dependências da Graph (token da Página, ids). null = configuração da Meta ausente. */
  graph: PublicarDeps | null;
  env?: Record<string, string | undefined>;
};

const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};
const txt = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

function falha(rede: RedeTestavel, detalhe: string, semConfiguracao = false): ResultadoTeste {
  return { rede, ok: false, conta: null, detalhe: detalhe.slice(0, 300), metricas: {}, semConfiguracao };
}

const META_AUSENTE = "Configuração da Meta ausente (token da Página, id da Página ou do Instagram).";
const COMPOSIO_AUSENTE = "Composio não configurado (COMPOSIO_API_KEY e COMPOSIO_USER_ID).";

async function testarInstagram(deps: DepsTeste): Promise<ResultadoTeste> {
  if (!deps.graph) return falha("instagram", META_AUSENTE, true);
  const d = await chamarGraph(deps.graph, "GET", deps.graph.igUserId, { fields: "username,followers_count,media_count" });
  const usuario = txt(d.username);
  if (!usuario) return falha("instagram", "A Graph respondeu sem o nome da conta do Instagram.");
  return {
    rede: "instagram",
    ok: true,
    conta: `@${usuario}`,
    detalhe: `Conta @${usuario} respondeu.`,
    metricas: { seguidores: num(d.followers_count), publicacoes: num(d.media_count) },
    semConfiguracao: false,
  };
}

async function testarFacebook(deps: DepsTeste): Promise<ResultadoTeste> {
  if (!deps.graph) return falha("facebook", META_AUSENTE, true);
  const pageId = deps.graph.pageId;
  if (!pageId) return falha("facebook", "META_PAGE_ID não configurado.", true);
  const d = await chamarGraph(deps.graph, "GET", pageId, { fields: "name,followers_count,fan_count" });
  const nome = txt(d.name);
  if (!nome) return falha("facebook", "A Graph respondeu sem o nome da Página.");
  return {
    rede: "facebook",
    ok: true,
    conta: nome,
    detalhe: `Página "${nome}" respondeu.`,
    metricas: { seguidores: num(d.followers_count), curtidas: num(d.fan_count) },
    semConfiguracao: false,
  };
}

async function testarYoutube(cfg: ComposioConfig | null, deps: DepsTeste): Promise<ResultadoTeste> {
  if (!cfg) return falha("youtube", COMPOSIO_AUSENTE, true);
  const d = await executarFerramenta(
    cfg,
    "YOUTUBE_LIST_CHANNELS",
    { mine: true, part: "snippet,statistics" },
    { fetch: deps.fetch, contaId: cfg.contas.youtube },
  );
  const itens = Array.isArray(d.items) ? (d.items as Array<Record<string, unknown>>) : [];
  const canal = itens[0];
  if (!canal) return falha("youtube", "A conta do Google conectada não tem canal no YouTube.");
  const snippet = (canal.snippet ?? {}) as Record<string, unknown>;
  const stats = (canal.statistics ?? {}) as Record<string, unknown>;
  const conta = txt(snippet.customUrl) || txt(snippet.title);
  return {
    rede: "youtube",
    ok: true,
    conta,
    detalhe: `Canal ${conta} respondeu.`,
    metricas: {
      inscritos: num(stats.subscriberCount),
      visualizacoes: num(stats.viewCount),
      publicacoes: num(stats.videoCount),
    },
    semConfiguracao: false,
  };
}

/** URN de pessoa a partir da resposta do LINKEDIN_GET_MY_INFO ({ id: "9HVN…" }). */
export function urnDoLinkedin(dados: Record<string, unknown>): string | null {
  const id = txt(dados.id) || txt(dados.sub);
  return /^[A-Za-z0-9_-]+$/.test(id) ? `urn:li:person:${id}` : null;
}

async function testarLinkedin(cfg: ComposioConfig | null, deps: DepsTeste): Promise<ResultadoTeste> {
  if (!cfg) return falha("linkedin", COMPOSIO_AUSENTE, true);
  const d = await executarFerramenta(cfg, "LINKEDIN_GET_MY_INFO", {}, { fetch: deps.fetch, contaId: cfg.contas.linkedin });
  const nome = [txt(d.localizedFirstName), txt(d.localizedLastName)].filter(Boolean).join(" ") || txt(d.name);
  const urn = urnDoLinkedin(d);
  if (!nome || !urn) return falha("linkedin", "O LinkedIn respondeu sem nome ou sem id do perfil.");
  const vanity = txt(d.vanityName);
  return {
    rede: "linkedin",
    ok: true,
    conta: vanity ? `${nome} (${vanity})` : nome,
    detalhe: `Perfil de ${nome} respondeu.`,
    // LinkedIn não entrega número de seguidores do perfil por esta permissão.
    metricas: { _autor: urn },
    semConfiguracao: false,
  };
}

async function testarX(cfg: ComposioConfig | null, deps: DepsTeste): Promise<ResultadoTeste> {
  if (!cfg) return falha("x", COMPOSIO_AUSENTE, true);
  if (!cfg.contas.x) return falha("x", "X ainda não conectado no Composio (falta COMPOSIO_X_ACCOUNT_ID).", true);
  const d = await executarFerramenta(
    cfg,
    "TWITTER_USER_LOOKUP_ME",
    { user_fields: ["public_metrics"] },
    { fetch: deps.fetch, contaId: cfg.contas.x },
  );
  const u = ((d.data ?? d) as Record<string, unknown>) ?? {};
  const usuario = txt(u.username);
  if (!usuario) return falha("x", "O X respondeu sem o nome da conta.");
  const pm = (u.public_metrics ?? {}) as Record<string, unknown>;
  return {
    rede: "x",
    ok: true,
    conta: `@${usuario}`,
    detalhe: `Conta @${usuario} respondeu.`,
    metricas: { seguidores: num(pm.followers_count), publicacoes: num(pm.tweet_count) },
    semConfiguracao: false,
  };
}

async function testarThreads(cfg: ComposioConfig | null, deps: DepsTeste): Promise<ResultadoTeste> {
  if (!cfg) return falha("threads", COMPOSIO_AUSENTE, true);
  if (!cfg.contas.threads) return falha("threads", "Threads ainda não conectado no Composio (falta COMPOSIO_THREADS_ACCOUNT_ID).", true);
  const d = await executarFerramenta(
    cfg,
    "THREADS_GET_MY_PROFILE",
    { fields: ["id", "username", "name"] },
    { fetch: deps.fetch, contaId: cfg.contas.threads },
  );
  const usuario = txt(d.username);
  if (!usuario) return falha("threads", "O Threads respondeu sem o nome da conta.");
  return {
    rede: "threads",
    ok: true,
    conta: `@${usuario}`,
    detalhe: `Conta @${usuario} respondeu.`,
    // Seguidores exigem a leitura de insights do perfil; fica para quando a conta tiver histórico.
    metricas: {},
    semConfiguracao: false,
  };
}

/** Testa uma rede. Nunca lança: qualquer erro vira resultado com o motivo, sem token nem chave no texto. */
export async function testarRede(rede: RedeTestavel, deps: DepsTeste): Promise<ResultadoTeste> {
  const env = deps.env ?? process.env;
  const cfg = composioConfig(env);
  try {
    switch (rede) {
      case "instagram":
        return await testarInstagram(deps);
      case "facebook":
        return await testarFacebook(deps);
      case "youtube":
        return await testarYoutube(cfg, deps);
      case "linkedin":
        return await testarLinkedin(cfg, deps);
      case "x":
        return await testarX(cfg, deps);
      case "threads":
        return await testarThreads(cfg, deps);
    }
  } catch (e) {
    const bruto = e instanceof Error ? e.message : "Erro desconhecido";
    return falha(rede, semChave(semToken(bruto, deps.graph?.token ?? ""), cfg?.apiKey ?? ""));
  }
}

/** Testa todas as redes em paralelo (cada uma isolada: a falha de uma não afeta as outras). */
export async function testarRedes(deps: DepsTeste, redes: readonly RedeTestavel[] = REDES_TESTAVEIS): Promise<ResultadoTeste[]> {
  return Promise.all(redes.map((r) => testarRede(r, deps)));
}

/** Linha de RedeSnapshot a gravar para um resultado. */
export function snapshotDoTeste(r: ResultadoTeste): { rede: RedeId; estado: "conectado" | "sem_dados" | "sem_conta"; metricas: Record<string, number | string | null> } {
  if (r.ok) {
    const metricas: Record<string, number | string | null> = {};
    for (const [k, v] of Object.entries(r.metricas)) if (v !== null) metricas[k] = v;
    if (r.conta) metricas._conta = r.conta;
    return { rede: r.rede, estado: "conectado", metricas };
  }
  return { rede: r.rede, estado: r.semConfiguracao ? "sem_conta" : "sem_dados", metricas: { _erro: r.detalhe } };
}
