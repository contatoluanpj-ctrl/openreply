import { createHash } from "node:crypto";
import { PublicadorErro } from "@/lib/opi/publicadores/tipos";

/**
 * Cliente REST mínimo do Composio (sem SDK), usado pelo YouTube, LinkedIn e X.
 *
 * Documentação usada (conferida em 14/11/2026):
 * - Execução de ferramenta: https://docs.composio.dev/reference/api-reference/tools/postToolsExecuteByToolSlug
 *     POST {base}/tools/execute/{tool_slug}   cabeçalho x-api-key
 *     corpo { user_id, connected_account_id?, arguments }   resposta { data, error, successful, log_id? }
 * - Upload de arquivo: https://docs.composio.dev/reference/api-reference/files/postFilesUploadRequest
 *     POST {base}/files/upload/request   corpo { toolkit_slug, tool_slug, filename, mimetype, md5 }
 *     resposta { id, key, new_presigned_url, metadata: { storage_backend } }
 *     depois PUT dos bytes na new_presigned_url; a `key` entra como `s3key` no argumento de arquivo da ferramenta.
 * - Versões da API: https://docs.composio.dev/reference/api-reference/tools (v3.1 é a atual; v3 segue aceita).
 */
export const COMPOSIO_BASE = "https://backend.composio.dev/api/v3.1";
export const COMPOSIO_NAO_CONFIGURADO = "Composio não configurado";

type Env = Record<string, string | undefined>;

export type RedeComposio = "youtube" | "linkedin" | "x";

export type ComposioConfig = {
  apiKey: string;
  userId: string;
  /** Conta conectada por rede (opcional: sem ela o Composio usa a conta padrão do user_id). */
  contas: Partial<Record<RedeComposio, string>>;
};

/** Lê a configuração do ambiente. null quando falta a chave ou o usuário: nada é chamado. */
export function composioConfig(env: Env = process.env): ComposioConfig | null {
  const apiKey = (env.COMPOSIO_API_KEY ?? "").trim();
  const userId = (env.COMPOSIO_USER_ID ?? "").trim();
  if (!apiKey || !userId) return null;
  const conta = (nome: string) => (env[nome] ?? "").trim() || undefined;
  return {
    apiKey,
    userId,
    contas: {
      youtube: conta("COMPOSIO_YOUTUBE_ACCOUNT_ID"),
      linkedin: conta("COMPOSIO_LINKEDIN_ACCOUNT_ID"),
      x: conta("COMPOSIO_X_ACCOUNT_ID"),
    },
  };
}

export class ComposioErro extends PublicadorErro {
  constructor(message: string, opcoes: { repetivel?: boolean } = {}) {
    super(message, opcoes);
    this.name = "ComposioErro";
  }
}

/** Tira a chave do texto e encurta: a mensagem vai para o banco e para o Telegram. */
export function semChave(texto: string, apiKey: string): string {
  let t = texto;
  if (apiKey) t = t.split(apiKey).join("[chave]");
  return t.replace(/\s+/g, " ").trim().slice(0, 300);
}

function mensagemDe(corpo: Record<string, unknown>): string {
  const e = corpo.error;
  if (typeof e === "string" && e) return e;
  if (e && typeof e === "object" && typeof (e as { message?: unknown }).message === "string") {
    return (e as { message: string }).message;
  }
  if (typeof corpo.message === "string" && corpo.message) return corpo.message;
  return "erro sem mensagem";
}

async function chamar(
  cfg: ComposioConfig,
  f: typeof fetch,
  caminho: string,
  corpo: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  let resposta: Response;
  try {
    resposta = await f(`${COMPOSIO_BASE}/${caminho}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": cfg.apiKey },
      body: JSON.stringify(corpo),
    });
  } catch (e) {
    throw new ComposioErro(semChave(`Falha de rede no Composio: ${e instanceof Error ? e.message : "erro"}`, cfg.apiKey));
  }
  let dados: Record<string, unknown> = {};
  try {
    dados = (await resposta.json()) as Record<string, unknown>;
  } catch {
    dados = {};
  }
  if (!resposta.ok) throw new ComposioErro(semChave(`Composio ${resposta.status}: ${mensagemDe(dados)}`, cfg.apiKey));
  return dados;
}

/**
 * Executa uma ferramenta do Composio e devolve o `data` da resposta.
 * Falha (HTTP ou successful=false) lança ComposioErro NÃO repetível: a ferramenta pode ter agido na rede.
 */
export async function executarFerramenta(
  cfg: ComposioConfig,
  slug: string,
  argumentos: Record<string, unknown>,
  opcoes: { fetch: typeof fetch; contaId?: string },
): Promise<Record<string, unknown>> {
  const corpo: Record<string, unknown> = { user_id: cfg.userId, arguments: argumentos };
  if (opcoes.contaId) corpo.connected_account_id = opcoes.contaId;
  const dados = await chamar(cfg, opcoes.fetch, `tools/execute/${encodeURIComponent(slug)}`, corpo);
  if (dados.successful !== true) {
    throw new ComposioErro(semChave(`Composio (${slug}): ${mensagemDe(dados)}`, cfg.apiKey));
  }
  return dados.data && typeof dados.data === "object" ? (dados.data as Record<string, unknown>) : {};
}

export type ArquivoComposio = { name: string; mimetype: string; s3key: string };

/**
 * Envia os bytes ao armazenamento do Composio e devolve a referência { name, mimetype, s3key }
 * que as ferramentas com campo de arquivo esperam. Nada é publicado aqui: a falha é repetível.
 */
export async function enviarArquivo(
  cfg: ComposioConfig,
  arquivo: { toolkitSlug: string; toolSlug: string; nome: string; mimetype: string; bytes: Uint8Array },
  f: typeof fetch,
): Promise<ArquivoComposio> {
  try {
    const md5 = createHash("md5").update(arquivo.bytes).digest("hex");
    const pedido = await chamar(cfg, f, "files/upload/request", {
      toolkit_slug: arquivo.toolkitSlug,
      tool_slug: arquivo.toolSlug,
      filename: arquivo.nome,
      mimetype: arquivo.mimetype,
      md5,
    });
    const key = typeof pedido.key === "string" ? pedido.key : "";
    const url = typeof pedido.new_presigned_url === "string" ? pedido.new_presigned_url : "";
    if (!key || !url.startsWith("https://")) throw new ComposioErro("Composio não devolveu o endereço de envio do arquivo");

    const backend = (pedido.metadata as { storage_backend?: string } | undefined)?.storage_backend;
    const headers: Record<string, string> = { "Content-Type": arquivo.mimetype };
    if (backend === "azure_blob_storage") headers["x-ms-blob-type"] = "BlockBlob"; // exigido pela doc para Azure
    let envio: Response;
    try {
      envio = await f(url, { method: "PUT", headers, body: arquivo.bytes as unknown as BodyInit });
    } catch (e) {
      throw new ComposioErro(`Falha de rede no envio do arquivo: ${e instanceof Error ? e.message : "erro"}`);
    }
    if (!envio.ok) throw new ComposioErro(`Envio do arquivo ao Composio falhou (${envio.status})`);
    return { name: arquivo.nome, mimetype: arquivo.mimetype, s3key: key };
  } catch (e) {
    throw new ComposioErro(semChave(e instanceof Error ? e.message : "Erro no envio do arquivo", cfg.apiKey), { repetivel: true });
  }
}

export const LIMITE_MIDIA_BYTES = 256 * 1024 * 1024;

/** Baixa a mídia pública do post para repassar ao Composio. Falha aqui é repetível (nada saiu). */
export async function baixarMidia(
  url: string,
  f: typeof fetch,
  limite = LIMITE_MIDIA_BYTES,
): Promise<{ bytes: Uint8Array; mimetype: string; nome: string }> {
  try {
    const resposta = await f(url);
    if (!resposta.ok) throw new Error(`HTTP ${resposta.status}`);
    const bytes = new Uint8Array(await resposta.arrayBuffer());
    if (bytes.byteLength === 0) throw new Error("arquivo vazio");
    if (bytes.byteLength > limite) throw new Error("arquivo acima do limite");
    const mimetype = (resposta.headers.get("content-type") ?? "").split(";")[0].trim() || "video/mp4";
    const nome = decodeURIComponent(new URL(url).pathname.split("/").pop() || "video.mp4");
    return { bytes, mimetype, nome };
  } catch (e) {
    throw new ComposioErro(`Não foi possível baixar a mídia do post: ${e instanceof Error ? e.message : "erro"}`.slice(0, 300), {
      repetivel: true,
    });
  }
}
