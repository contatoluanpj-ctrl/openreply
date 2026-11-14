import { PublicadorErro } from "@/lib/opi/publicadores/tipos";

/** Chamada à Graph API da Meta com o token da Página. Usada pelo Instagram e pelo Facebook. */

export type PublicarDeps = {
  fetch: typeof fetch;
  token: string;
  igUserId: string;
  versao: string;
  /** Página do Facebook (META_PAGE_ID). Só o publicador do Facebook usa. */
  pageId?: string;
  /** Espera entre consultas do status do vídeo. Injetável nos testes. */
  esperar?: (ms: number) => Promise<void>;
  /** Intervalo e limite da espera do vídeo. Padrão: 10 s, 30 tentativas (~5 min). */
  intervaloReelMs?: number;
  tentativasReel?: number;
};

export class GraphErro extends PublicadorErro {
  constructor(message: string, opcoes: { repetivel?: boolean } = {}) {
    super(message, opcoes);
    this.name = "GraphErro";
  }
}

export function semToken(texto: string, token: string): string {
  let t = texto;
  if (token) t = t.split(token).join("[token]");
  return t.replace(/access_token=[^&\s"]+/g, "access_token=[token]").slice(0, 300);
}

export async function chamarGraph(
  deps: PublicarDeps,
  metodo: "GET" | "POST",
  caminho: string,
  params: Record<string, string>,
): Promise<Record<string, unknown>> {
  const base = `https://graph.facebook.com/${deps.versao}/${caminho}`;
  let resposta: Response;
  try {
    if (metodo === "GET") {
      const url = new URL(base);
      for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
      url.searchParams.set("access_token", deps.token);
      resposta = await deps.fetch(url.toString());
    } else {
      const corpo = new URLSearchParams({ ...params, access_token: deps.token });
      resposta = await deps.fetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: corpo.toString(),
      });
    }
  } catch (e) {
    throw new GraphErro(semToken(`Falha de rede na Graph: ${e instanceof Error ? e.message : "erro"}`, deps.token));
  }
  let dados: Record<string, unknown> = {};
  try {
    dados = (await resposta.json()) as Record<string, unknown>;
  } catch {
    dados = {};
  }
  if (!resposta.ok || dados.error) {
    const err = (dados.error ?? {}) as { message?: string; code?: number };
    const msg = `Graph ${resposta.status}${err.code ? ` (código ${err.code})` : ""}: ${err.message ?? "erro sem mensagem"}`;
    throw new GraphErro(semToken(msg, deps.token));
  }
  return dados;
}

export function idDe(dados: Record<string, unknown>, etapa: string): string {
  const id = dados.id;
  if (typeof id !== "string" || !id) throw new GraphErro(`Graph não devolveu id em ${etapa}`);
  return id;
}
