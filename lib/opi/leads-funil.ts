// Leads e funil (/dashboard/leads): comentário com a palavra -> DM enviada -> formulário aberto -> formulário
// enviado -> aceitou contato. As duas primeiras etapas vêm do DmLog (banco do painel). As de formulário NÃO estão
// no banco do painel: vêm de um webhook de leitura do n8n (OPI_FUNIL_URL), que devolve SÓ contagens.
// Nenhum nome, telefone ou e-mail de lead entra aqui: o zod descarta qualquer campo fora do contrato.
import { z } from "zod";
import { conversaoPorPalavra, soAtivas, type LogDm } from "@/lib/opi/dashboard-dados";

// ---------------------------------------------------------------------------------------------------------------
// Materiais

export const MATERIAIS = [
  { id: "termos", nome: "Termos", palavras: ["TERMOS", "TERMO"] },
  { id: "juros", nome: "Juros", palavras: ["JUROS"] },
  { id: "erros", nome: "Erros", palavras: ["ERROS", "ERRO"] },
  { id: "estrategias", nome: "Estratégias", palavras: ["ESTRATEGIAS", "ESTRATEGIA"] },
  { id: "coberta", nome: "Coberta", palavras: ["COBERTA"] },
] as const;

export type MaterialId = (typeof MATERIAIS)[number]["id"];

function normalizar(palavra: string): string {
  return palavra
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase();
}

const PALAVRA_MATERIAL = new Map<string, MaterialId>(MATERIAIS.flatMap((m) => m.palavras.map((p) => [p, m.id] as const)));

/** TERMOS -> termos, "estratégias" -> estrategias (aceita acento, minúscula e o singular). Fora da lista: null. */
export function materialDaPalavra(palavra: string): MaterialId | null {
  return PALAVRA_MATERIAL.get(normalizar(palavra)) ?? null;
}

// ---------------------------------------------------------------------------------------------------------------
// Contrato do webhook (só números)

const contagem = z.coerce.number().int().min(0);

const materialSchema = z.object({
  id: z.string().trim().toLowerCase().min(1).max(40),
  aberturas: contagem,
  envios: contagem,
  leads: contagem,
  aceiteContato: contagem,
});

const semanaSchema = z.object({
  semana: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  leads: contagem,
});

// z.object descarta chaves desconhecidas: um "nome" ou "telefone" que o webhook mande por engano não passa.
export const funilSchema = z.object({
  atualizadoEm: z.string().refine((s) => !Number.isNaN(Date.parse(s)), "data inválida"),
  materiais: z.array(materialSchema).max(50),
  porSemana: z.array(semanaSchema).max(120).default([]),
});

export type FunilLeads = z.infer<typeof funilSchema>;

export type ResultadoFunil =
  | { ok: true; dados: FunilLeads }
  | { ok: false; motivo: "nao_configurada" | "indisponivel" };

export const TIMEOUT_FUNIL_MS = 8000;

type Env = Record<string, string | undefined>;
type FetchFunil = (
  url: string,
  init: { method: "GET"; headers: Record<string, string>; cache: "no-store"; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/** Busca as contagens no webhook do n8n. Nunca lança; o segredo e a URL nunca vão ao log. */
export async function buscarFunil(env: Env = process.env, fetchImpl: FetchFunil = (u, i) => fetch(u, i)): Promise<ResultadoFunil> {
  const url = (env.OPI_FUNIL_URL ?? "").trim();
  const segredo = (env.OPI_FUNIL_SECRET ?? "").trim();
  if (!url || !segredo) return { ok: false, motivo: "nao_configurada" };
  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: { "x-opi-secret": segredo },
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_FUNIL_MS),
    });
    if (!res.ok) {
      console.error(`[OPI Funil] Fonte de leads respondeu HTTP ${res.status}`);
      return { ok: false, motivo: "indisponivel" };
    }
    const lido = funilSchema.safeParse(await res.json());
    if (!lido.success) {
      console.error("[OPI Funil] Resposta da fonte de leads fora do contrato");
      return { ok: false, motivo: "indisponivel" };
    }
    return { ok: true, dados: lido.data };
  } catch (e) {
    console.error("[OPI Funil] Fonte de leads indisponível:", e instanceof Error ? e.name : "erro");
    return { ok: false, motivo: "indisponivel" };
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Funil por material

export type EtapasFormulario = {
  aberturas: number;
  envios: number;
  leads: number;
  aceiteContato: number;
  /** (aberturas − envios) / aberturas, em % com 1 casa. Sem abertura: null. */
  desistenciaPct: number | null;
  /** aceiteContato / leads (ou / envios quando a fonte não manda leads), em % com 1 casa. */
  aceitePct: number | null;
};

export type LinhaFunil = {
  id: string;
  nome: string;
  /** Palavras do DmLog somadas nesta linha (ex.: TERMO e TERMOS). */
  palavras: string[];
  comentarios: number;
  dms: number;
  /** DMs enviadas / comentários com a palavra, em %. */
  taxaDmPct: number | null;
  formulario: EtapasFormulario | null;
};

export type Funil = {
  linhas: LinhaFunil[];
  /** Palavras de campanha ativa que não são de nenhum material (só as etapas do DmLog). */
  outras: LinhaFunil[];
  total: { comentarios: number; dms: number; aberturas: number; envios: number; leads: number; aceiteContato: number };
  /** Total atual da meta "Leads com contato". Null sem a fonte de leads. */
  leadsComContato: number | null;
};

const pct1 = (parte: number, todo: number): number | null => (todo > 0 ? Math.round((parte / todo) * 1000) / 10 : null);

export function etapasFormulario(m: { aberturas: number; envios: number; leads: number; aceiteContato: number }): EtapasFormulario {
  const desistencia = m.aberturas > 0 ? pct1(Math.max(0, m.aberturas - m.envios), m.aberturas) : null;
  const base = m.leads > 0 ? m.leads : m.envios;
  const aceite = pct1(m.aceiteContato, base);
  return { ...m, desistenciaPct: desistencia, aceitePct: aceite === null ? null : Math.min(100, aceite) };
}

/**
 * Junta o DmLog (só campanhas ativas) com as contagens do webhook, uma linha por material, na ordem de MATERIAIS.
 * `funil` null = fonte de leads não configurada/indisponível: as etapas do DmLog continuam.
 */
export function montarFunil(logs: LogDm[], funil: FunilLeads | null): Funil {
  const porPalavra = conversaoPorPalavra(soAtivas(logs), Number.MAX_SAFE_INTEGER);
  const dm = new Map<string, { comentarios: number; dms: number; palavras: string[] }>();
  const outras: LinhaFunil[] = [];

  for (const p of porPalavra) {
    const id = materialDaPalavra(p.palavra);
    if (!id) {
      outras.push({
        id: p.palavra,
        nome: p.palavra,
        palavras: [p.palavra],
        comentarios: p.comentarios,
        dms: p.enviadas,
        taxaDmPct: p.taxa,
        formulario: null,
      });
      continue;
    }
    const atual = dm.get(id) ?? { comentarios: 0, dms: 0, palavras: [] };
    atual.comentarios += p.comentarios;
    atual.dms += p.enviadas;
    atual.palavras.push(p.palavra);
    dm.set(id, atual);
  }

  // Se o webhook repetir um material, as contagens somam.
  const form = new Map<string, { aberturas: number; envios: number; leads: number; aceiteContato: number }>();
  for (const m of funil?.materiais ?? []) {
    const a = form.get(m.id) ?? { aberturas: 0, envios: 0, leads: 0, aceiteContato: 0 };
    form.set(m.id, {
      aberturas: a.aberturas + m.aberturas,
      envios: a.envios + m.envios,
      leads: a.leads + m.leads,
      aceiteContato: a.aceiteContato + m.aceiteContato,
    });
  }

  const linha = (id: string, nome: string): LinhaFunil => {
    const d = dm.get(id) ?? { comentarios: 0, dms: 0, palavras: [] };
    const f = form.get(id);
    return {
      id,
      nome,
      palavras: d.palavras,
      comentarios: d.comentarios,
      dms: d.dms,
      taxaDmPct: pct1(d.dms, d.comentarios),
      formulario: funil ? etapasFormulario(f ?? { aberturas: 0, envios: 0, leads: 0, aceiteContato: 0 }) : null,
    };
  };

  const conhecidos = new Set<string>(MATERIAIS.map((m) => m.id));
  const linhas = [
    ...MATERIAIS.map((m) => linha(m.id, m.nome)),
    // Material novo no webhook, ainda sem palavra mapeada: aparece com o id, sem etapas de DM.
    ...[...form.keys()].filter((id) => !conhecidos.has(id)).map((id) => linha(id, id)),
  ];

  const soma = (f: (l: LinhaFunil) => number) => linhas.reduce((t, l) => t + f(l), 0);
  const total = {
    comentarios: soma((l) => l.comentarios),
    dms: soma((l) => l.dms),
    aberturas: soma((l) => l.formulario?.aberturas ?? 0),
    envios: soma((l) => l.formulario?.envios ?? 0),
    leads: soma((l) => l.formulario?.leads ?? 0),
    aceiteContato: soma((l) => l.formulario?.aceiteContato ?? 0),
  };

  return { linhas, outras, total, leadsComContato: funil ? total.aceiteContato : null };
}

// ---------------------------------------------------------------------------------------------------------------
// Meta

/** Meta do trimestre: leads com contato até 13/12/2026 (fim do dia em São Paulo). */
export const META_LEADS_DATA = "2026-12-13";

export function diasAteMeta(agora: Date, data: string = META_LEADS_DATA): number {
  const fim = Date.parse(`${data}T23:59:59-03:00`);
  return Math.max(0, Math.ceil((fim - agora.getTime()) / (24 * 60 * 60 * 1000)));
}

/** Semanas em ordem crescente, com rótulo "dd/mm" e a largura da barra (0–100) relativa à melhor semana. */
export function semanasDoFunil(porSemana: { semana: string; leads: number }[]): { semana: string; rotulo: string; leads: number; largura: number }[] {
  const ordenadas = [...porSemana].sort((a, b) => a.semana.localeCompare(b.semana));
  const max = Math.max(0, ...ordenadas.map((s) => s.leads));
  return ordenadas.map((s) => ({
    semana: s.semana,
    rotulo: `${s.semana.slice(8, 10)}/${s.semana.slice(5, 7)}`,
    leads: s.leads,
    largura: max > 0 ? Math.round((s.leads / max) * 100) : 0,
  }));
}
