import { randomBytes } from "node:crypto";
import { z } from "zod";

/**
 * Mídia fora do repositório (Vercel Blob, loja pública).
 *
 * O PC do Luan (esteira de vídeo) pede aqui um endereço de envio e sobe o arquivo direto para o Blob com um
 * PUT comum, sem SDK e sem token em trânsito. O painel só assina o endereço: caminho, tipo e tamanho ficam
 * presos na assinatura, então quem tem o endereço só consegue subir aquele arquivo.
 *
 * Documentação usada (conferida em 19/11/2026):
 * - https://vercel.com/docs/vercel-blob/vercel-signed-urls (issueSignedToken, presignUrl, operação "put")
 * - https://vercel.com/docs/vercel-blob/usage-and-pricing (plano gratuito: 1 GB e 10 GB de tráfego por mês)
 * O arquivo é apagado sozinho depois de MIDIA_DIAS dias (ttlDays): as redes já copiaram a mídia quando publicam.
 */
export const MIDIA_DIAS = 60;
export const MIDIA_VALIDADE_MS = 15 * 60_000;
export const MIDIA_NAO_CONFIGURADA = "Armazenamento de mídia não configurado";
const MB = 1024 * 1024;

/** Extensões aceitas, com o tipo e o tamanho máximo de cada uma. */
export const MIDIA_TIPOS = {
  mp4: { mimetype: "video/mp4", maximo: 300 * MB },
  png: { mimetype: "image/png", maximo: 8 * MB },
  jpg: { mimetype: "image/jpeg", maximo: 8 * MB },
  jpeg: { mimetype: "image/jpeg", maximo: 8 * MB },
} as const;
export type ExtensaoMidia = keyof typeof MIDIA_TIPOS;

export const pedidoMidiaSchema = z
  .object({
    /** Nome do arquivo, só para ficar legível no caminho. */
    nome: z.string().trim().min(1).max(120),
    /** Tamanho exato em bytes. */
    tamanho: z.number().int().positive(),
  })
  .strict();
export type PedidoMidia = z.infer<typeof pedidoMidiaSchema>;

export class MidiaErro extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "MidiaErro";
  }
}

export function extensaoDaMidia(nome: string): ExtensaoMidia | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(nome.trim())?.[1]?.toLowerCase() ?? "";
  return ext in MIDIA_TIPOS ? (ext as ExtensaoMidia) : null;
}

/** Nome seguro para o caminho: sem acento, sem espaço, sem barra, até 60 caracteres antes da extensão. */
export function nomeSeguro(nome: string): string {
  const semExt = nome.trim().replace(/\.[A-Za-z0-9]+$/, "");
  const limpo = semExt
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return limpo || "arquivo";
}

/** Caminho no Blob: opi/AAAA-MM/<16 hex aleatórios>-<nome>.<ext>. O trecho aleatório impede adivinhar a URL. */
export function caminhoDaMidia(nome: string, agora: Date, aleatorio: string): string {
  const ext = extensaoDaMidia(nome);
  if (!ext) throw new MidiaErro("Tipo de arquivo não aceito (use mp4, png ou jpg)");
  return `opi/${agora.toISOString().slice(0, 7)}/${aleatorio}-${nomeSeguro(nome)}.${ext === "jpeg" ? "jpg" : ext}`;
}

type Env = Record<string, string | undefined>;

/** Id da loja do Blob em minúsculas e sem o prefixo "store_", como aparece no endereço público. */
export function lojaDoBlob(env: Env = process.env): string | null {
  const id = (env.BLOB_STORE_ID ?? "").trim().replace(/^store_/i, "").toLowerCase();
  return /^[a-z0-9]+$/.test(id) ? id : null;
}

export const armazenamentoConfigurado = (env: Env = process.env): boolean =>
  lojaDoBlob(env) !== null || (env.BLOB_READ_WRITE_TOKEN ?? "").trim().length > 0;

const HOST_BLOB = /^([a-z0-9]+)\.public\.blob\.vercel-storage\.com$/;

/**
 * true só para mídia que está no nosso armazenamento: a loja pública do Blob deste projeto, ou a pasta /m/ do
 * próprio painel. Rotas que criam post por chave de serviço só aceitam mídia daqui, nunca um endereço qualquer.
 */
export function midiaDoNossoArmazenamento(url: string, env: Env = process.env): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== "https:" || u.username || u.password || u.port) return false;
  const loja = lojaDoBlob(env);
  const blob = HOST_BLOB.exec(u.hostname);
  if (blob) return loja !== null && blob[1] === loja && u.pathname.startsWith("/opi/");
  const painel = (env.NEXTAUTH_URL ?? "").trim();
  if (!painel) return false;
  try {
    return u.origin === new URL(painel).origin && /^\/m\/[A-Za-z0-9._/-]+$/.test(u.pathname) && !u.pathname.includes("..");
  } catch {
    return false;
  }
}

export type SdkBlob = {
  issueSignedToken: (o: {
    pathname: string;
    operations: Array<"put">;
    allowedContentTypes: string[];
    maximumSizeInBytes: number;
    validUntil: number;
  }) => Promise<{ delegationToken: string; clientSigningToken: string; validUntil: number }>;
  presignUrl: (
    token: { delegationToken: string; clientSigningToken: string },
    o: {
      operation: "put";
      pathname: string;
      access: "public";
      validUntil: number;
      allowedContentTypes: string[];
      maximumSizeInBytes: number;
      addRandomSuffix: boolean;
      allowOverwrite: boolean;
      ttlDays: number;
    },
  ) => Promise<{ presignedUrl: string }>;
};

export type EnvioMidia = {
  /** Endereço assinado: o arquivo sobe com um PUT comum, com o cabeçalho Content-Type igual a contentType. */
  uploadUrl: string;
  metodo: "PUT";
  contentType: string;
  pathname: string;
  /** Endereço público esperado depois do envio (null quando o id da loja não é conhecido). Confira com a resposta do PUT. */
  urlPublica: string | null;
  expiraEm: string;
  apagaEmDias: number;
};

/** Monta o endereço de envio de uma mídia. Não envia nada: só assina. */
export async function emitirEnvioDeMidia(
  pedido: PedidoMidia,
  deps: { sdk: SdkBlob; env?: Env; agora?: () => Date; aleatorio?: () => string },
): Promise<EnvioMidia> {
  const env = deps.env ?? process.env;
  if (!armazenamentoConfigurado(env)) throw new MidiaErro(MIDIA_NAO_CONFIGURADA, 503);
  const ext = extensaoDaMidia(pedido.nome);
  if (!ext) throw new MidiaErro("Tipo de arquivo não aceito (use mp4, png ou jpg)");
  const { mimetype, maximo } = MIDIA_TIPOS[ext];
  if (pedido.tamanho > maximo) throw new MidiaErro(`Arquivo acima do limite de ${Math.round(maximo / MB)} MB`, 413);

  const agora = (deps.agora ?? (() => new Date()))();
  const pathname = caminhoDaMidia(pedido.nome, agora, (deps.aleatorio ?? (() => randomBytes(8).toString("hex")))());
  const validUntil = agora.getTime() + MIDIA_VALIDADE_MS;
  // O tamanho pedido vira o teto assinado: o endereço não serve para subir um arquivo maior.
  const limites = { allowedContentTypes: [mimetype], maximumSizeInBytes: pedido.tamanho, validUntil };
  const token = await deps.sdk.issueSignedToken({ pathname, operations: ["put"], ...limites });
  const { presignedUrl } = await deps.sdk.presignUrl(token, {
    operation: "put",
    pathname,
    access: "public",
    ...limites,
    addRandomSuffix: false,
    allowOverwrite: false,
    ttlDays: MIDIA_DIAS,
  });
  if (!presignedUrl.startsWith("https://")) throw new MidiaErro("O armazenamento não devolveu o endereço de envio", 502);
  const loja = lojaDoBlob(env);
  return {
    uploadUrl: presignedUrl,
    metodo: "PUT",
    contentType: mimetype,
    pathname,
    urlPublica: loja ? `https://${loja}.public.blob.vercel-storage.com/${pathname}` : null,
    expiraEm: new Date(validUntil).toISOString(),
    apagaEmDias: MIDIA_DIAS,
  };
}
