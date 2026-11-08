"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatarBRL } from "@/lib/opi/financeiro";
import { COR, rotuloMes, Vazio } from "./graficos-base";

export { CabecalhoGrafico, COR, Legenda, rotuloMes, Vazio } from "./graficos-base";
import type { FatiaCategoria, PontoMes, PrevistoPago } from "@/lib/opi/financeiro-dados";

/** Rampa do donut: laranja e grafite alternados, do mais forte ao mais leve. */
const RAMPA = ["#D9541E", "#111217", "#E8936B", "rgba(17,18,23,.45)", "#F3C2A9", "rgba(17,18,23,.2)"];

/** "R$ 1,2 mil" no eixo, para não poluir. */
function brlCurto(centavos: number) {
  const v = centavos / 100;
  const abs = Math.abs(v);
  if (abs >= 1000) return `${v < 0 ? "−" : ""}R$ ${(abs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil`;
  return `${v < 0 ? "−" : ""}R$ ${Math.round(abs)}`;
}

const EIXO = { fontSize: 11, fill: COR.eixo };

type ItemTip = { name?: string | number; value?: number | string; color?: string; dataKey?: string | number };

function Dica({ active, payload, label, rotulos }: { active?: boolean; payload?: ItemTip[]; label?: string; rotulos: Record<string, string> }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="opi-tip">
      <i className="block not-italic text-white/60">{label ? rotuloMes(String(label), true) : ""}</i>
      {payload.map((p) => (
        <div key={String(p.dataKey)} className="mt-0.5 flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-white/70">{rotulos[String(p.dataKey)] ?? p.name}</span>
          <b className="ml-auto pl-3 text-[13px] tabular-nums">{formatarBRL(Number(p.value ?? 0))}</b>
        </div>
      ))}
    </div>
  );
}

/** Barras agrupadas: receita (laranja) x despesa (grafite) por mês. */
export function GraficoReceitaDespesa({ serie }: { serie: PontoMes[] }) {
  if (serie.every((p) => p.receita === 0 && p.despesa === 0)) {
    return <Vazio titulo="Sem lançamentos no período" texto="As barras aparecem quando houver receitas ou despesas lançadas abaixo." />;
  }
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={serie} barGap={4} barCategoryGap="22%" margin={{ top: 16, right: 4, left: 4, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis dataKey="mes" tickFormatter={(m) => rotuloMes(m)} axisLine={false} tickLine={false} tick={EIXO} />
          <YAxis tickFormatter={brlCurto} axisLine={false} tickLine={false} tick={EIXO} width={64} />
          <Tooltip cursor={{ fill: "rgba(17,18,23,.04)" }} content={<Dica rotulos={{ receita: "Receita", despesa: "Despesa" }} />} />
          <Bar dataKey="receita" fill={COR.principal} radius={[6, 6, 0, 0]} maxBarSize={22} />
          <Bar dataKey="despesa" fill={COR.secundaria} radius={[6, 6, 0, 0]} maxBarSize={22} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Área do saldo acumulado: mostra se o caixa da OPI está subindo ou queimando. */
export function GraficoSaldo({ serie }: { serie: PontoMes[] }) {
  if (serie.every((p) => p.receita === 0 && p.despesa === 0) && serie.every((p) => p.acumulado === 0)) {
    return <Vazio titulo="Saldo ainda sem histórico" texto="A linha aparece com o primeiro lançamento: soma receitas menos despesas, mês a mês." />;
  }
  const negativo = serie.some((p) => p.acumulado < 0);
  return (
    <div className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={serie} margin={{ top: 16, right: 4, left: 4, bottom: 0 }}>
          <defs>
            <linearGradient id="opi-fin-saldo" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={COR.principal} stopOpacity={0.35} />
              <stop offset="100%" stopColor={COR.principal} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke={COR.grade} />
          <XAxis dataKey="mes" tickFormatter={(m) => rotuloMes(m)} axisLine={false} tickLine={false} tick={EIXO} />
          <YAxis tickFormatter={brlCurto} axisLine={false} tickLine={false} tick={EIXO} width={64} />
          {negativo && <ReferenceLine y={0} stroke={COR.terciaria} strokeDasharray="4 4" />}
          <Tooltip
            cursor={{ stroke: "rgba(17,18,23,.25)", strokeDasharray: "4 4" }}
            content={<Dica rotulos={{ acumulado: "Saldo acumulado", saldo: "Saldo do mês" }} />}
          />
          <Area
            type="monotone"
            dataKey="acumulado"
            stroke={COR.principal}
            strokeWidth={3}
            fill="url(#opi-fin-saldo)"
            activeDot={{ r: 6, fill: COR.principal, stroke: "#fff", strokeWidth: 2 }}
            dot={false}
          />
          <Area type="monotone" dataKey="saldo" stroke={COR.terciaria} strokeWidth={1.5} strokeDasharray="4 4" fill="none" dot={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Donut de despesas por categoria + lista com %, no formato do donut do artefato. */
export function DonutCategorias({ fatias }: { fatias: FatiaCategoria[] }) {
  if (fatias.length === 0) {
    return <Vazio titulo="Nenhuma despesa no período" texto="Cada despesa lançada entra na sua categoria; o maior gasto aparece primeiro." altura={200} />;
  }
  const total = fatias.reduce((s, f) => s + f.valor, 0);
  return (
    <div className="flex flex-wrap items-center justify-center gap-5">
      <div className="relative h-[170px] w-[170px] flex-none">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={fatias}
              dataKey="valor"
              nameKey="categoria"
              innerRadius={57}
              outerRadius={75}
              paddingAngle={fatias.length > 1 ? 2 : 0}
              cornerRadius={3}
              stroke="none"
              isAnimationActive={false}
            >
              {fatias.map((f, i) => (
                <Cell key={f.categoria} fill={RAMPA[i % RAMPA.length]} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) =>
                active && payload?.length ? (
                  <div className="opi-tip">
                    <i className="block not-italic text-white/60">{String(payload[0].name)}</i>
                    <b className="tabular-nums">{formatarBRL(Number(payload[0].value ?? 0))}</b>
                  </div>
                ) : null
              }
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <b className="opi-num text-lg leading-none">{brlCurto(total)}</b>
          <span className="mt-1 text-[10px] font-semibold uppercase tracking-[.1em] text-muted">despesas</span>
        </div>
      </div>
      <ul className="min-w-[11rem] flex-1">
        {fatias.map((f, i) => (
          <li key={f.categoria} className="my-1.5 flex items-center justify-between gap-2 text-[13px]">
            <span className="flex min-w-0 items-center gap-2 text-foreground/70">
              <i className="inline-block h-2.5 w-2.5 flex-none rounded-full" style={{ background: RAMPA[i % RAMPA.length] }} />
              <span className="truncate">{f.categoria}</span>
            </span>
            <b className="whitespace-nowrap font-semibold tabular-nums text-foreground">
              {formatarBRL(f.valor)} · {f.pct}%
            </b>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Barra({ titulo, pp, rotuloPago }: { titulo: string; pp: PrevistoPago; rotuloPago: string }) {
  const pct = pp.pctPago ?? 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <span className="opi-label">{titulo}</span>
        <span className="opi-num text-sm">{pp.pctPago === null ? "—" : `${pct}%`}</span>
      </div>
      <div
        className="mt-2 h-3 w-full overflow-hidden rounded-full bg-[rgba(17,18,23,.07)]"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`${titulo}: ${pct}% ${rotuloPago}`}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${pct}%`,
            background: "linear-gradient(90deg, rgba(217,84,30,.55), #D9541E)",
            boxShadow: pct > 0 ? "0 0 16px rgba(217,84,30,.45)" : "none",
          }}
        />
      </div>
      <div className="mt-2 flex flex-wrap justify-between gap-2 text-xs text-muted">
        <span>
          <b className="font-semibold text-foreground">{formatarBRL(pp.pago)}</b> {rotuloPago}
        </span>
        <span>
          <b className="font-semibold text-foreground">{formatarBRL(pp.previsto)}</b> ainda previsto
        </span>
      </div>
    </div>
  );
}

/** Quanto do mês já saiu (ou entrou) de fato versus o que ainda está só previsto. */
export function PrevistoPagoMes({ despesas, receitas }: { despesas: PrevistoPago; receitas: PrevistoPago }) {
  if (despesas.total === 0 && receitas.total === 0) {
    return <Vazio titulo="Nada lançado neste mês" texto="Lance as contas do mês como Previsto e marque Pago quando sair do caixa." altura={160} />;
  }
  return (
    <div className="grid gap-5">
      <Barra titulo="Despesas pagas" pp={despesas} rotuloPago="pago" />
      <Barra titulo="Receitas recebidas" pp={receitas} rotuloPago="recebido" />
    </div>
  );
}
