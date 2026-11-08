import { z } from "zod";

/**
 * OPI Central — Financeiro. Lógica pura (sem banco), usada pelas rotas
 * app/api/opi/financeiro e pela página /dashboard/financeiro.
 *
 * Dinheiro é sempre somado em centavos inteiros, nunca em float.
 * Ads ficam só em leitura: nada aqui gasta, só registra.
 */

export const TIPOS = ["RECEITA", "DESPESA"] as const;
export const STATUS = ["PREVISTO", "PAGO"] as const;
export type Tipo = (typeof TIPOS)[number];
export type Status = (typeof STATUS)[number];

const MES_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;
const VALOR_RE = /^\d{1,10}(\.\d{1,2})?$/;

/** Aceita "149", "149.9", "149,90", "1.234,56", 149.9. Devolve string com 2 casas ("149.90"). */
const valorSchema = z
  .union([z.string(), z.number()])
  .transform((v, ctx) => {
    // Formato brasileiro: com vírgula, o ponto é separador de milhar ("1.234,56").
    const bruto = typeof v === "number" ? String(v) : v.trim();
    const txt = bruto.includes(",") ? bruto.replace(/\./g, "").replace(",", ".") : bruto;
    if (!VALOR_RE.test(txt)) {
      ctx.addIssue({ code: "custom", message: "Valor inválido (use até 2 casas decimais)" });
      return z.NEVER;
    }
    const centavos = paraCentavos(txt);
    if (centavos <= 0) {
      ctx.addIssue({ code: "custom", message: "Valor precisa ser maior que zero" });
      return z.NEVER;
    }
    return deCentavos(centavos);
  });

const dataSchema = z
  .string()
  .trim()
  .refine((s) => /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(new Date(s).getTime()), {
    message: "Data inválida (use AAAA-MM-DD)",
  })
  .transform((s) => (s.length === 10 ? new Date(`${s}T12:00:00.000Z`) : new Date(s)));

export const lancamentoSchema = z.object({
  data: dataSchema,
  tipo: z.enum(TIPOS),
  categoria: z.string().trim().min(1, "Categoria obrigatória").max(60),
  descricao: z.string().trim().min(1, "Descrição obrigatória").max(200),
  valor: valorSchema,
  status: z.enum(STATUS).default("PREVISTO"),
});

export const lancamentoPatchSchema = z
  .object({
    data: dataSchema,
    tipo: z.enum(TIPOS),
    categoria: z.string().trim().min(1).max(60),
    descricao: z.string().trim().min(1).max(200),
    valor: valorSchema,
    status: z.enum(STATUS),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: "Nada para atualizar" });

export type LancamentoEntrada = z.infer<typeof lancamentoSchema>;

/** Converte valor (string, number ou Prisma.Decimal) em centavos inteiros sem passar por float. */
export function paraCentavos(valor: unknown): number {
  const txt = typeof valor === "string" ? valor.trim() : String(valor ?? "0");
  const m = /^(-)?(\d+)(?:\.(\d+))?$/.exec(txt);
  if (!m) return 0;
  const inteiro = Number(m[2]);
  const frac = Number(((m[3] ?? "") + "00").slice(0, 2));
  const total = inteiro * 100 + frac;
  return m[1] ? -total : total;
}

export function deCentavos(centavos: number): string {
  const neg = centavos < 0;
  const abs = Math.abs(centavos);
  const txt = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
  return neg ? `-${txt}` : txt;
}

export function mesValido(mes: string): boolean {
  return MES_RE.test(mes);
}

/** "2026-11" → { gte: 2026-11-01T00:00Z, lt: 2026-12-01T00:00Z }. Lança erro se inválido. */
export function filtroMes(mes: string): { gte: Date; lt: Date } {
  const m = MES_RE.exec(mes);
  if (!m) throw new Error("Mês inválido (use AAAA-MM)");
  const ano = Number(m[1]);
  const idx = Number(m[2]) - 1;
  return { gte: new Date(Date.UTC(ano, idx, 1)), lt: new Date(Date.UTC(ano, idx + 1, 1)) };
}

export function chaveMes(data: Date): string {
  return `${data.getUTCFullYear()}-${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Os `n` meses que terminam em `ate` (inclusive), do mais antigo ao mais novo. */
export function ultimosMeses(ate: string, n = 6): string[] {
  const { gte } = filtroMes(ate);
  const meses: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    meses.push(chaveMes(new Date(Date.UTC(gte.getUTCFullYear(), gte.getUTCMonth() - i, 1))));
  }
  return meses;
}

type Linha = { tipo: string; valor: unknown; status?: string; data?: Date | string };

export interface Resumo {
  /** Todos os valores em centavos. */
  receita: number;
  despesa: number;
  saldo: number;
  previsto: number;
  pago: number;
}

/** Soma em centavos. "previsto" e "pago" são saldos (receita − despesa) de cada status. */
export function resumo(lancamentos: Linha[]): Resumo {
  let receita = 0;
  let despesa = 0;
  let previsto = 0;
  let pago = 0;
  for (const l of lancamentos) {
    const c = paraCentavos(l.valor);
    const sinal = l.tipo === "RECEITA" ? 1 : -1;
    if (l.tipo === "RECEITA") receita += c;
    else despesa += c;
    if (l.status === "PAGO") pago += sinal * c;
    else previsto += sinal * c;
  }
  return { receita, despesa, saldo: receita - despesa, previsto, pago };
}

export interface BarraMes {
  mes: string;
  receita: number;
  despesa: number;
}

/** Agrupa por mês (centavos). Se `meses` vier, devolve exatamente esses meses, com zero onde faltar. */
export function porMes(lancamentos: Linha[], meses?: string[]): BarraMes[] {
  const mapa = new Map<string, BarraMes>();
  for (const m of meses ?? []) mapa.set(m, { mes: m, receita: 0, despesa: 0 });
  for (const l of lancamentos) {
    if (!l.data) continue;
    const chave = chaveMes(new Date(l.data));
    let barra = mapa.get(chave);
    if (!barra) {
      if (meses) continue;
      barra = { mes: chave, receita: 0, despesa: 0 };
      mapa.set(chave, barra);
    }
    if (l.tipo === "RECEITA") barra.receita += paraCentavos(l.valor);
    else barra.despesa += paraCentavos(l.valor);
  }
  return [...mapa.values()].sort((a, b) => a.mes.localeCompare(b.mes));
}

export interface LancamentoJson {
  id: string;
  data: string;
  tipo: Tipo;
  categoria: string;
  descricao: string;
  valor: string;
  status: Status;
}

/** Decimal não vira JSON: o valor sai como string "149.00". */
export function serializar(l: {
  id: string;
  data: Date | string;
  tipo: string;
  categoria: string;
  descricao: string;
  valor: unknown;
  status: string;
}): LancamentoJson {
  return {
    id: l.id,
    data: new Date(l.data).toISOString(),
    tipo: l.tipo as Tipo,
    categoria: l.categoria,
    descricao: l.descricao,
    valor: deCentavos(paraCentavos(l.valor)),
    status: l.status as Status,
  };
}

export function formatarBRL(centavos: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(centavos / 100);
}

export function mesAtual(agora = new Date()): string {
  return chaveMes(agora);
}
