// Portão do Jev da OPI para o "comente PALAVRA → DM" (PARECER-NOV-2026 §3.3/§3.4/§8.2, D-0016 "Jev primeiro").
// Porte em TypeScript da regra de Lumio/automation/n8n-workflows/build-opi-dm.mjs (casarPalavra, corpoJev,
// decidirJev, resolverCaso, PERGUNTAS, LIMIARES, CORTESIA, CONTEXTO, JEV_TENTATIVAS). Mudanças de regra
// nascem lá; aqui só se porta.
//
// Tudo neste arquivo é puro ou recebe fetch/sleep injetados, para os testes não tocarem rede nem banco.
import { createHash } from "node:crypto";

export type Env = Record<string, string | undefined>;
export const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
export const JEV_TENTATIVAS = 3;
export const JEV_TIMEOUT_MS = 20_000;
// Espera entre tentativas de uma falha passageira (rede, 429, 5xx), dentro do mesmo job.
export const JEV_ESPERAS_MS = [2_000, 5_000];
export const MAX_TOKENS = 8;
export const PROCESSO_LEDGER = "openreply.dm";
export const SESSAO_LEDGER = "OpenReply";

// Palavras que não mudam o sentido de "só a palavra-chave" (pedido simples do material).
export const CORTESIA = [
  "oi", "ola", "opa", "eu", "quero", "queria", "gostaria", "de", "receber", "me", "manda", "mande", "envia", "envie",
  "pode", "por", "favor", "pf", "pfv", "pfvr", "porfavor", "o", "a", "material", "pdf", "link", "aqui", "sim", "please", "pls",
  "obrigado", "obrigada", "obg", "valeu", "vlw", "bom", "boa", "dia", "tarde", "noite", "top",
];

export const CONTEXTO =
  "Public comment on an Instagram Reel by OPI, a Brazilian educational brand about stock options. The Reel caption asks viewers to comment a keyword to receive a free study material (PDF) by direct message. Comments are in Brazilian Portuguese.";

export type ChavePergunta = "so_palavra" | "pede_orientacao" | "avalia_operacao" | "reclamacao_legal" | "dado_pessoal";

export const PERGUNTAS: Record<ChavePergunta, { id: string; version: number; type: "noul"; instructions: string }> = {
  so_palavra: {
    id: "opi.dm.so_palavra", version: 1, type: "noul",
    instructions: 'Is `comentario` basically only the keyword `palavra_chave`, or the keyword plus a simple request for the material (such as "quero", "por favor", "me manda"), with no other question, opinion, complaint or information? Context: `contexto`.',
  },
  pede_orientacao: {
    id: "opi.dm.pede_orientacao", version: 1, type: "noul",
    instructions: "Does `comentario` ask what to buy, sell or set up, which asset or strike to choose, when to enter or exit a trade, or mention the commenter's own position, portfolio or investments? Context: `contexto`.",
  },
  avalia_operacao: {
    id: "opi.dm.avalia_operacao", version: 1, type: "noul",
    instructions: "Does `comentario` describe a specific trade or operation and ask for an opinion, evaluation or rating of it? Context: `contexto`.",
  },
  reclamacao_legal: {
    id: "opi.dm.reclamacao_legal", version: 1, type: "noul",
    instructions: "Does `comentario` contain a complaint, a threat, a refund request, or a mention of a regulator (such as CVM), a lawyer, a court, a consumer-protection agency or the press? Context: `contexto`.",
  },
  dado_pessoal: {
    id: "opi.dm.dado_pessoal", version: 1, type: "noul",
    instructions: "Does `comentario` contain personal or account data, such as a CPF or other document number, a phone number, an e-mail, bank or brokerage account details, a statement or a brokerage screenshot? Context: `contexto`.",
  },
};
export const CHAVES = Object.keys(PERGUNTAS) as ChavePergunta[];

// PARECER §3.3: errar mandando ao Luan custa minutos; errar respondendo sozinho custa conformidade.
export const LIMIARES: Record<ChavePergunta, number> = {
  so_palavra: 0.8, pede_orientacao: 0.1, avalia_operacao: 0.1, reclamacao_legal: 0.05, dado_pessoal: 0.05,
};

export type Decisao =
  | "enviar"
  | "compliance"
  | "luan"
  | "manual_revisao"
  | "manual_jev_falhou"
  | "manual_texto_extra"
  | "jev_indisponivel";

export type Probabilidades = Record<ChavePergunta, number | null>;

// ---- Ligado/desligado ----
export function gateLigado(env: Env = process.env): boolean {
  const v = String(env.OPI_JEV_GATE ?? "").trim().toLowerCase();
  return !["off", "false", "0", "nao", "não", "desligado"].includes(v);
}
export function pausaPrimeiraDmLigada(env: Env = process.env): boolean {
  return String(env.OPI_PAUSE_AFTER_FIRST_DM ?? "").trim().toLowerCase() === "true";
}

// ---- Casamento ----
export function normalizar(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export type Casamento = { palavra: string | null; essencial: boolean; motivo?: string; texto?: string };

// O comentário tem de ser essencialmente a palavra: caixa, acento, pontuação e emoji não importam; além da
// palavra, só cabem palavras de CORTESIA, até MAX_TOKENS tokens. As palavras-chave vêm da campanha e podem ter
// mais de um token ("quero link"): casa a sequência mais longa primeiro.
export function casarPalavra(texto: unknown, palavrasChave: readonly string[]): Casamento {
  const tokens = normalizar(texto).split(" ").filter(Boolean);
  const chaves = [...new Set(palavrasChave.map((k) => String(k ?? "")).filter((k) => normalizar(k)))]
    .map((original) => ({ original, toks: normalizar(original).split(" ") }))
    .sort((a, b) => b.toks.length - a.toks.length);
  const achadas: string[] = [];
  const extras: string[] = [];
  for (let i = 0; i < tokens.length; ) {
    const hit = chaves.find((k) => k.toks.every((t, j) => tokens[i + j] === t));
    if (hit) {
      if (!achadas.includes(hit.original)) achadas.push(hit.original);
      i += hit.toks.length;
    } else {
      if (!CORTESIA.includes(tokens[i])) extras.push(tokens[i]);
      i += 1;
    }
  }
  // Duas grafias da mesma palavra na lista da campanha ("JUROS" e "juros") contam como uma.
  const distintas = [...new Set(achadas.map(normalizar))];
  if (!achadas.length) return { palavra: null, essencial: false, motivo: "sem palavra-chave isolada" };
  if (distintas.length > 1) return { palavra: achadas[0], essencial: false, motivo: "mais de uma palavra-chave" };
  if (extras.length || tokens.length > MAX_TOKENS) {
    return { palavra: achadas[0], essencial: false, motivo: "texto além da palavra-chave" };
  }
  return { palavra: achadas[0], essencial: true, texto: tokens.join(" ") };
}

// ---- Chamada ----
export type CorpoJev = {
  model: "jev-latest";
  state: { comentario: string; palavra_chave: string; contexto: string };
  questions: Record<ChavePergunta, { type: "noul"; instructions: string }>;
};

export function corpoJev(palavra: string | null, texto: unknown): CorpoJev {
  const questions = {} as CorpoJev["questions"];
  for (const k of CHAVES) questions[k] = { type: PERGUNTAS[k].type, instructions: PERGUNTAS[k].instructions };
  return {
    model: "jev-latest",
    state: { comentario: String(texto ?? "").slice(0, 500), palavra_chave: palavra ?? "", contexto: CONTEXTO },
    questions,
  };
}

const f2 = (v: number) => v.toFixed(2).replace(".", ",");

// Recebe o corpo da resposta do TypeSafe (ou null se a chamada falhou). Qualquer p ausente = falha = não envia.
export function decidirJev(corpo: unknown): { decisao: Decisao; p: Probabilidades; motivo: string } {
  const ans =
    corpo && typeof corpo === "object" && (corpo as { answers?: unknown }).answers &&
    typeof (corpo as { answers?: unknown }).answers === "object"
      ? ((corpo as { answers: Record<string, unknown> }).answers)
      : null;
  const p = {} as Probabilidades;
  for (const k of CHAVES) {
    const a = ans ? (ans[k] as { noul?: unknown } | undefined) : undefined;
    const v = a && typeof a === "object" ? a.noul : undefined;
    p[k] = typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1 ? v : null;
  }
  if (CHAVES.some((k) => p[k] === null)) {
    return { decisao: "manual_jev_falhou", p, motivo: "o Jev não respondeu as 5 perguntas" };
  }
  const q = p as Record<ChavePergunta, number>;
  if (q.reclamacao_legal >= LIMIARES.reclamacao_legal || q.dado_pessoal >= LIMIARES.dado_pessoal) {
    return { decisao: "compliance", p, motivo: `reclamacao_legal ${f2(q.reclamacao_legal)} · dado_pessoal ${f2(q.dado_pessoal)} (limiar 0,05)` };
  }
  if (q.pede_orientacao >= LIMIARES.pede_orientacao || q.avalia_operacao >= LIMIARES.avalia_operacao) {
    return { decisao: "luan", p, motivo: `pede_orientacao ${f2(q.pede_orientacao)} · avalia_operacao ${f2(q.avalia_operacao)} (limiar 0,10)` };
  }
  if (q.so_palavra < LIMIARES.so_palavra) {
    return { decisao: "manual_revisao", p, motivo: `so_palavra ${f2(q.so_palavra)} < 0,80` };
  }
  return { decisao: "enviar", p, motivo: `so_palavra ${f2(q.so_palavra)}, sem sinal de risco` };
}

// Resposta HTTP do TypeSafe já reduzida: status + corpo JSON, ou erro de rede/timeout. null = sem resposta.
export type RespostaJev = { statusCode?: number; body?: unknown; error?: string } | null;

export type Caso = { soTriagem: boolean; motivoTriagem?: string; tentativa: number };
export type Resolucao = { decisao: Decisao; motivo: string; p: Probabilidades; falha: string; passageira: boolean };

// Decisão de um caso a partir da resposta do Jev.
// - Triagem (texto além da palavra): NUNCA vira envio (PARECER §3.4). O Jev só marca Compliance ou orientação.
// - Falha passageira (sem resposta, rede/timeout, 429, 5xx): "jev_indisponivel" até JEV_TENTATIVAS; na última,
//   ou com 4xx/resposta incompleta, "manual_jev_falhou" (revisão manual).
export function resolverCaso(c: Caso, r: RespostaJev): Resolucao {
  const ok = !!r && !r.error && Number(r.statusCode) === 200 && !!r.body && typeof r.body === "object";
  const d = decidirJev(ok ? r!.body : null);
  const falha = ok ? "" : "falha do Jev: " + String((r && (r.error ? r.error : r.statusCode)) || "sem resposta").slice(0, 150);
  const st = r ? Number(r.statusCode) : NaN;
  const passageira = !ok && (!r || !!r.error || st === 429 || st >= 500);
  const tentativa = Number(c.tentativa) || 1;
  const base = { p: d.p, falha, passageira };
  if (c.soTriagem) {
    const motivo = String(c.motivoTriagem || "texto além da palavra-chave");
    if (d.decisao === "compliance" || d.decisao === "luan") return { ...base, decisao: d.decisao, motivo: `${motivo}; ${d.motivo}` };
    return {
      ...base,
      decisao: "manual_texto_extra",
      motivo: motivo + (d.decisao === "manual_jev_falhou"
        ? "; o Jev não respondeu, então não há marca de Compliance: leia com atenção"
        : "; o Jev não marcou Compliance nem orientação"),
    };
  }
  if (d.decisao === "manual_jev_falhou" && passageira && tentativa < JEV_TENTATIVAS) {
    return { ...base, decisao: "jev_indisponivel", motivo: `tentativa ${tentativa} de ${JEV_TENTATIVAS}; ${falha}` };
  }
  if (d.decisao === "manual_jev_falhou") {
    return { ...base, decisao: "manual_jev_falhou", motivo: `${d.motivo} (tentativa ${tentativa}; ${falha})` };
  }
  return { ...base, decisao: d.decisao, motivo: d.motivo };
}

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ status: number; json: () => Promise<unknown> }>;

export async function chamarJev(corpo: CorpoJev, apiKey: string, fetchImpl: FetchLike, timeoutMs = JEV_TIMEOUT_MS): Promise<RespostaJev> {
  try {
    const res = await fetchImpl(TYPESAFE_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(timeoutMs) : undefined,
    });
    let body: unknown = null;
    try { body = await res.json(); } catch { body = null; }
    return { statusCode: res.status, body };
  } catch (e) {
    // Só o nome/mensagem do erro: nunca a chave nem os headers.
    return { error: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 150) : "erro de rede" };
  }
}

export type Avaliacao = {
  decisao: Exclude<Decisao, "jev_indisponivel">;
  motivo: string;
  p: Probabilidades;
  palavra: string | null;
  soTriagem: boolean;
  tentativas: number;
  erro: string | null;
};

// Uma avaliação completa de um comentário/mensagem: casa a palavra, chama o Jev (com novas tentativas para
// falha passageira) e devolve a decisão final. Fail-closed: sem chave, Jev fora, resposta incompleta ou p
// inválido nunca resulta em "enviar".
export async function avaliarComentario(opts: {
  texto: string;
  palavrasChave: readonly string[];
  matchAnyWord?: boolean;
  apiKey: string | undefined;
  fetchImpl: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  esperasMs?: readonly number[];
}): Promise<Avaliacao> {
  const m = casarPalavra(opts.texto, opts.palavrasChave);
  const soTriagem = !m.essencial;
  const motivoTriagem = m.palavra === null && opts.matchAnyWord
    ? "campanha \"qualquer palavra\" sem palavra-chave isolada no texto"
    : m.motivo;
  const vazio = Object.fromEntries(CHAVES.map((k) => [k, null])) as Probabilidades;
  const apiKey = (opts.apiKey ?? "").trim();
  if (!apiKey) {
    const falha = "TYPESAFE_API_KEY ausente: o Jev não foi chamado";
    return {
      decisao: soTriagem ? "manual_texto_extra" : "manual_jev_falhou",
      motivo: soTriagem ? `${motivoTriagem}; ${falha}` : falha,
      p: vazio, palavra: m.palavra, soTriagem, tentativas: 0, erro: falha,
    };
  }
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const esperas = opts.esperasMs ?? JEV_ESPERAS_MS;
  const corpo = corpoJev(m.palavra, opts.texto);
  for (let tentativa = 1; ; tentativa++) {
    const r = await chamarJev(corpo, apiKey, opts.fetchImpl);
    const x = resolverCaso({ soTriagem, motivoTriagem, tentativa }, r);
    if (x.decisao !== "jev_indisponivel") {
      return { decisao: x.decisao, motivo: x.motivo, p: x.p, palavra: m.palavra, soTriagem, tentativas: tentativa, erro: x.falha || null };
    }
    await sleep(esperas[Math.min(tentativa - 1, esperas.length - 1)] ?? 0);
  }
}

// ---- Registro (jev-ledger) ----
export function hashEntrada(texto: unknown, palavra: string | null): string {
  return createHash("sha256").update(normalizar(texto) + "|" + normalizar(palavra ?? "")).digest("hex").slice(0, 32);
}

export type LinhaLedgerDb = {
  workspaceId: string; automationId: string; commentId: string; pergunta: string; versao: number;
  p: number | null; erro: string | null; decisao: string; entradaHash: string;
};

// Uma linha por pergunta por chamada (mesmo quando a chamada falhou: p = null e o erro explicam a falha).
export function linhasLedger(a: Avaliacao, ctx: { workspaceId: string; automationId: string; commentId: string; texto: string }): LinhaLedgerDb[] {
  const entradaHash = hashEntrada(ctx.texto, a.palavra);
  return CHAVES.map((k) => ({
    workspaceId: ctx.workspaceId, automationId: ctx.automationId, commentId: ctx.commentId,
    pergunta: PERGUNTAS[k].id, versao: PERGUNTAS[k].version, p: a.p[k],
    erro: a.p[k] === null ? String(a.erro || a.motivo || "sem resposta").slice(0, 200) : null,
    decisao: a.decisao, entradaHash,
  }));
}

export type JevLedgerRow = LinhaLedgerDb & { id: string; createdAt: Date; finalLuan: boolean | null; resultadoReal: string | null };

// Formato da linha do Lumio automation/jev-ledger/ledger.jsonl:
// id, data, processo, pergunta, versao, ref, entrada, p, erro, final_luan, resultado_real, sessao.
// O id é estável (mesma linha do banco = mesmo id), então o export pode rodar toda semana sem duplicar.
export function paraLinhaJsonl(r: JevLedgerRow) {
  return {
    id: createHash("sha1").update(["openreply_jev_ledger", r.id].join("|")).digest("hex").slice(0, 12),
    data: r.createdAt.toISOString(),
    processo: PROCESSO_LEDGER,
    pergunta: r.pergunta,
    versao: r.versao,
    ref: "ig_comment:" + r.commentId,
    entrada: { entrada_hash: r.entradaHash, automation_id: r.automationId, workspace_id: r.workspaceId, decisao: r.decisao },
    p: r.p,
    erro: r.p === null ? (r.erro ?? "sem resposta") : null,
    final_luan: r.finalLuan,
    resultado_real: r.resultadoReal,
    sessao: SESSAO_LEDGER,
  };
}

// ---- Aviso ao Luan ----
const ROTULO: Record<string, string> = {
  compliance: "Luan + Compliance", luan: "Luan", manual_revisao: "revisão manual", manual_jev_falhou: "Jev falhou",
  manual_texto_extra: "texto além da palavra", campanha_pausada: "campanha pausada",
};

export function mensagemTelegram(x: { campanha: string; usuario: string | null; texto: string; decisao: string; motivo: string; origem: "comentário" | "DM" }): string {
  const t = String(x.texto ?? "");
  const trecho = t.length > 200 ? t.slice(0, 200) + "…" : t;
  const linhas = [
    `OpenReply OPI: ${x.origem} segurado, nada foi enviado (nem DM nem resposta pública).`,
    `Campanha: ${x.campanha}`,
    `Usuário: @${x.usuario || "desconhecido"}`,
    `Texto: ${trecho}`,
    `Decisão: ${ROTULO[x.decisao] ?? x.decisao}`,
    `Motivo: ${x.motivo}`,
  ];
  if (x.decisao === "compliance") linhas.push("", "Encaminhe hoje à Compliance (PARECER §3.3). Não peça nem guarde dados pessoais fora do Instagram.");
  return linhas.join("\n");
}

export function mensagemPausa(x: { campanha: string; usuario: string | null }): string {
  return [
    `OpenReply OPI: 1ª DM da campanha "${x.campanha}" (para @${x.usuario || "desconhecido"}).`,
    "A campanha foi PAUSADA (isActive=false) antes do envio, para a Compliance conferir texto, aviso e link (PARECER §8.2-4).",
    "As próximas DMs não saem até você reativar a campanha no painel.",
  ].join("\n");
}

export type TelegramFetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) =>
  Promise<{ ok: boolean; status: number }>;

// Falha no Telegram nunca derruba o job: devolve false e registra só o status (o token nunca vai ao log).
export async function avisarTelegram(texto: string, env: Env, fetchImpl: TelegramFetch): Promise<boolean> {
  const token = (env.OPI_TELEGRAM_BOT_TOKEN ?? "").trim();
  const chatId = (env.OPI_TELEGRAM_CHAT_ID ?? "").trim();
  if (!token || !chatId) return false;
  try {
    const res = await fetchImpl(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: texto.slice(0, 4000), disable_web_page_preview: true }),
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(10_000) : undefined,
    });
    if (!res.ok) console.error(`[OPI Jev] Aviso no Telegram falhou (HTTP ${res.status})`);
    return res.ok;
  } catch (e) {
    console.error("[OPI Jev] Aviso no Telegram falhou:", e instanceof Error ? e.name : "erro");
    return false;
  }
}

// ---- Pausa da 1ª DM (§8.2-4) ----
export type DbPausa = {
  automation: {
    count: (args: { where: { id: string; isActive: boolean } }) => Promise<number>;
    updateMany: (args: { where: { id: string; isActive: boolean }; data: { isActive: boolean } }) => Promise<{ count: number }>;
  };
  dmLog: { count: (args: { where: { automationId: string; status: "SENT" } }) => Promise<number> };
};

// "normal": já houve DM SENT e a campanha segue ativa → envia.
// "primeira": esta é a 1ª DM; a campanha acabou de ser desativada atomicamente por ESTE job → envia só esta.
// "pausada": a campanha está inativa (outro job pegou a 1ª, ou o Luan ainda não reativou) → não envia.
export async function reservarPrimeiraDm(db: DbPausa, automationId: string): Promise<"normal" | "primeira" | "pausada"> {
  const ativa = await db.automation.count({ where: { id: automationId, isActive: true } });
  if (!ativa) return "pausada";
  const enviados = await db.dmLog.count({ where: { automationId, status: "SENT" } });
  if (enviados > 0) return "normal";
  const r = await db.automation.updateMany({ where: { id: automationId, isActive: true }, data: { isActive: false } });
  return r.count === 1 ? "primeira" : "pausada";
}
