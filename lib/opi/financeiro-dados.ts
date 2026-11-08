import { chaveMes, paraCentavos, ultimosMeses } from "@/lib/opi/financeiro";

/**
 * OPI Central — Financeiro: agregações puras para os gráficos da página (sem banco).
 * Tudo em centavos inteiros. Nada aqui inventa número: só soma o que veio do banco.
 */

export type LinhaFin = {
  data: Date | string;
  tipo: string;
  valor: unknown;
  status?: string;
  categoria?: string;
};

export interface PontoMes {
  mes: string;
  receita: number;
  despesa: number;
  /** receita − despesa do mês */
  saldo: number;
  /** saldo somado desde o primeiro lançamento até o fim deste mês */
  acumulado: number;
}

export interface FatiaCategoria {
  categoria: string;
  valor: number;
  /** 0–100, inteiro arredondado */
  pct: number;
}

export interface PrevistoPago {
  total: number;
  pago: number;
  previsto: number;
  /** 0–100 do total já pago; null quando não há nada no mês */
  pctPago: number | null;
}

export interface KpisFin {
  receita: number;
  despesa: number;
  saldo: number;
  receitaAnterior: number;
  despesaAnterior: number;
  saldoAnterior: number;
  /** despesa média por mês (centavos) nos últimos meses com lançamento; null sem histórico */
  burnMedio: number | null;
  /** quantos meses entraram na média do burn */
  burnMeses: number;
}

export interface PainelFin {
  mes: string;
  serie: PontoMes[];
  kpis: KpisFin;
  categoriasMes: FatiaCategoria[];
  categorias12m: FatiaCategoria[];
  despesasMes: PrevistoPago;
  receitasMes: PrevistoPago;
  temLancamentos: boolean;
}

const ehReceita = (l: LinhaFin) => l.tipo === "RECEITA";
const mesDe = (l: LinhaFin) => chaveMes(new Date(l.data));

/** Receita, despesa, saldo e saldo acumulado de cada mês pedido (inclui o que veio antes da janela no acumulado). */
export function serieMensal(lancamentos: LinhaFin[], meses: string[]): PontoMes[] {
  const porMes = new Map<string, { receita: number; despesa: number }>();
  for (const m of meses) porMes.set(m, { receita: 0, despesa: 0 });
  let antes = 0;
  const primeiro = meses[0];
  for (const l of lancamentos) {
    const m = mesDe(l);
    const c = paraCentavos(l.valor);
    const sinal = ehReceita(l) ? 1 : -1;
    const alvo = porMes.get(m);
    if (alvo) {
      if (ehReceita(l)) alvo.receita += c;
      else alvo.despesa += c;
    } else if (primeiro && m < primeiro) {
      antes += sinal * c;
    }
  }
  let acumulado = antes;
  return meses.map((mes) => {
    const { receita, despesa } = porMes.get(mes)!;
    const saldo = receita - despesa;
    acumulado += saldo;
    return { mes, receita, despesa, saldo, acumulado };
  });
}

/** Soma por categoria, maior primeiro; depois de `max` fatias o resto vira "Outras". */
export function porCategoria(lancamentos: LinhaFin[], tipo: "RECEITA" | "DESPESA" = "DESPESA", max = 5): FatiaCategoria[] {
  const mapa = new Map<string, number>();
  for (const l of lancamentos) {
    if (l.tipo !== tipo) continue;
    const nome = (l.categoria ?? "").trim() || "Sem categoria";
    mapa.set(nome, (mapa.get(nome) ?? 0) + paraCentavos(l.valor));
  }
  const ordenado = [...mapa.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const total = ordenado.reduce((s, [, v]) => s + v, 0);
  if (total === 0) return [];
  const topo = ordenado.slice(0, max);
  const resto = ordenado.slice(max).reduce((s, [, v]) => s + v, 0);
  const lista = topo.map(([categoria, valor]) => ({ categoria, valor }));
  if (resto > 0) lista.push({ categoria: "Outras", valor: resto });
  return lista.map((f) => ({ ...f, pct: Math.round((f.valor / total) * 100) }));
}

/** Quanto do tipo pedido já foi pago e quanto ainda está previsto. */
export function previstoPago(lancamentos: LinhaFin[], tipo: "RECEITA" | "DESPESA" = "DESPESA"): PrevistoPago {
  let pago = 0;
  let previsto = 0;
  for (const l of lancamentos) {
    if (l.tipo !== tipo) continue;
    const c = paraCentavos(l.valor);
    if (l.status === "PAGO") pago += c;
    else previsto += c;
  }
  const total = pago + previsto;
  return { total, pago, previsto, pctPago: total > 0 ? Math.round((pago / total) * 100) : null };
}

/**
 * Burn mensal médio: despesa média dos `n` meses que terminam em `mesRef`,
 * contando só a partir do primeiro mês com algum lançamento (mês sem histórico não dilui a média).
 */
export function burnMedio(serie: PontoMes[], mesRef: string, n = 3): { valor: number | null; meses: number } {
  const ate = serie.filter((p) => p.mes <= mesRef);
  const inicio = ate.findIndex((p) => p.receita > 0 || p.despesa > 0);
  if (inicio < 0) return { valor: null, meses: 0 };
  const janela = ate.slice(inicio).slice(-n);
  const soma = janela.reduce((s, p) => s + p.despesa, 0);
  return { valor: Math.round(soma / janela.length), meses: janela.length };
}

/** Variação percentual inteira; null quando não há base para comparar. */
export function variacao(atual: number, anterior: number): number | null {
  if (!anterior) return null;
  return Math.round(((atual - anterior) / Math.abs(anterior)) * 100);
}

/** Tudo que a página precisa, a partir dos lançamentos até o fim de `mesRef`. */
export function montarPainel(lancamentos: LinhaFin[], mesRef: string, nMeses = 12): PainelFin {
  const meses = ultimosMeses(mesRef, nMeses);
  const serie = serieMensal(lancamentos, meses);
  const atual = serie[serie.length - 1];
  const anterior = serie[serie.length - 2] ?? { receita: 0, despesa: 0, saldo: 0 };
  const doMes = lancamentos.filter((l) => mesDe(l) === mesRef);
  const naJanela = lancamentos.filter((l) => mesDe(l) >= meses[0] && mesDe(l) <= mesRef);
  const burn = burnMedio(serie, mesRef, 3);
  return {
    mes: mesRef,
    serie,
    kpis: {
      receita: atual.receita,
      despesa: atual.despesa,
      saldo: atual.saldo,
      receitaAnterior: anterior.receita,
      despesaAnterior: anterior.despesa,
      saldoAnterior: anterior.saldo,
      burnMedio: burn.valor,
      burnMeses: burn.meses,
    },
    categoriasMes: porCategoria(doMes),
    categorias12m: porCategoria(naJanela),
    despesasMes: previstoPago(doMes, "DESPESA"),
    receitasMes: previstoPago(doMes, "RECEITA"),
    temLancamentos: naJanela.length > 0,
  };
}
