import { AVISO_OBRIGATORIO, temAviso } from "@/lib/opi/aviso";
import { COMPOSIO_NAO_CONFIGURADO, composioConfig, executarFerramenta } from "@/lib/opi/publicadores/composio";
import {
  PublicadorErro,
  aguardando,
  textoDoDestino,
  type DestinoParaPublicar,
  type PostParaPublicar,
  type ResultadoDestino,
} from "@/lib/opi/publicadores/tipos";

/**
 * Threads pelo Composio, ferramenta THREADS_CREATE_POST (esquema lido do Composio em 14/11/2026):
 *   entrada  { media_type: "TEXT", text (até 500 bytes UTF-8), text_attachment?: { plaintext (até 10.000 caracteres) } }
 *   saída    data { post_id, permalink?, container_id, publication_status: "PUBLISHED" }
 *
 * Decisão do Luan (14/11/2026): a conta é a pessoal dele e o Threads é rede de texto, como o X. Não recebe
 * Reel: recebe o mesmo post escrito para o LinkedIn. Por isso este publicador só manda TEXTO, nunca vídeo.
 * Como LinkedIn e X, o destino nunca é criado sozinho e só sai depois de aprovado (PostDestino.aprovadoEm),
 * com o texto do próprio destino (descricao), nunca a legenda do Reel.
 *
 * O texto do LinkedIn costuma passar dos 500 bytes do Threads. Nesse caso o post sai com a abertura
 * (1º parágrafo, cortado em palavra inteira se preciso) + o aviso obrigatório no corpo, e o texto
 * completo no anexo de texto do próprio Threads. É um post só: ou sai inteiro, ou não sai.
 */
export const THREADS_FERRAMENTA = "THREADS_CREATE_POST";
export const THREADS_TEXTO_MAX_BYTES = 500;
export const THREADS_ANEXO_MAX = 10_000;
export const THREADS_SEM_CONTA = "Threads ainda não conectado (falta COMPOSIO_THREADS_ACCOUNT_ID)";

/** O limite do Threads é em bytes UTF-8, não em caracteres (acento conta 2). */
export const bytesUtf8 = (texto: string): number => new TextEncoder().encode(texto).length;

export type ArgumentosThreads = { media_type: "TEXT"; text: string; text_attachment?: { plaintext: string } };

/** Corta em palavra inteira para caber em `maxBytes`, com reticências quando cortou. */
function cortarEmBytes(texto: string, maxBytes: number): string {
  if (bytesUtf8(texto) <= maxBytes) return texto;
  const palavras = texto.split(/\s+/);
  let saida = "";
  for (const p of palavras) {
    const tentativa = saida ? `${saida} ${p}` : p;
    if (bytesUtf8(`${tentativa}…`) > maxBytes) break;
    saida = tentativa;
  }
  return saida ? `${saida}…` : "";
}

/**
 * Monta o post do Threads a partir do texto aprovado. Função pura: a tela pode usar para mostrar a prévia.
 * - cabe em 500 bytes: sai como está;
 * - não cabe: abertura + aviso no corpo, texto completo no anexo.
 */
export function montarThreads(textoBruto: string): ArgumentosThreads {
  const texto = textoBruto.trim();
  if (bytesUtf8(texto) <= THREADS_TEXTO_MAX_BYTES) return { media_type: "TEXT", text: texto };
  const rodape = `\n\n${AVISO_OBRIGATORIO}`;
  const primeiro = texto.split(/\n\s*\n/)[0].replace(/\s+/g, " ").trim();
  // Se o 1º parágrafo já é o próprio aviso (ou o contém), a abertura não repete o aviso.
  const abertura = cortarEmBytes(temAviso(primeiro) ? "" : primeiro, THREADS_TEXTO_MAX_BYTES - bytesUtf8(rodape));
  return { media_type: "TEXT", text: abertura ? `${abertura}${rodape}` : AVISO_OBRIGATORIO, text_attachment: { plaintext: texto } };
}

type Env = Record<string, string | undefined>;

export async function publicarThreads(
  post: PostParaPublicar,
  destino: DestinoParaPublicar,
  ctx: { fetch: typeof fetch; env?: Env },
): Promise<ResultadoDestino> {
  if (!destino.aprovadoEm) return aguardando("Threads só publica destino aprovado");
  const cfg = composioConfig(ctx.env ?? process.env);
  if (!cfg) return aguardando(COMPOSIO_NAO_CONFIGURADO);
  if (!cfg.contas.threads) return aguardando(THREADS_SEM_CONTA);

  const texto = textoDoDestino(post, destino);
  if (!texto) throw new PublicadorErro("Threads sem texto próprio no destino");
  if (texto.length > THREADS_ANEXO_MAX) throw new PublicadorErro(`Texto do Threads passa de ${THREADS_ANEXO_MAX} caracteres`);
  if (!temAviso(texto)) throw new PublicadorErro("Texto do Threads sem o aviso obrigatório. Nada foi publicado.");

  const argumentos = montarThreads(texto);
  // Garantia final, depois da montagem: o que aparece no corpo do post leva o aviso e cabe no limite.
  if (!temAviso(argumentos.text) || bytesUtf8(argumentos.text) > THREADS_TEXTO_MAX_BYTES) {
    throw new PublicadorErro("Não foi possível montar o post do Threads dentro do limite com o aviso. Nada foi publicado.");
  }

  const dados = await executarFerramenta(cfg, THREADS_FERRAMENTA, argumentos, { fetch: ctx.fetch, contaId: cfg.contas.threads });
  const id = [dados.post_id, dados.id].find((v): v is string => typeof v === "string" && v.length > 0) ?? "";
  // A ferramenta respondeu com sucesso: o post saiu. Sem id não há como repetir com segurança.
  if (!id) throw new PublicadorErro("O Threads aceitou o post, mas não devolveu o id. Confira no perfil.");
  const permalink = typeof dados.permalink === "string" && dados.permalink.startsWith("https://") ? dados.permalink : null;
  return { situacao: "publicado", externoId: id, permalink };
}
