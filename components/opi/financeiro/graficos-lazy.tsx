"use client";

// Gráficos do Financeiro com import dinâmico: o recharts (~100 KB gz) só baixa quando o painel desenha,
// e a troca de seção não espera por ele. Enquanto carrega, fica um bloco do mesmo tamanho.
import dynamic from "next/dynamic";

const Reserva = ({ altura }: { altura: number }) => (
  <div aria-hidden className="animate-pulse rounded-2xl bg-[#111217]/[0.05]" style={{ height: altura }} />
);

export const GraficoReceitaDespesa = dynamic(() => import("./graficos").then((m) => m.GraficoReceitaDespesa), {
  ssr: false,
  loading: () => <Reserva altura={260} />,
});
export const GraficoSaldo = dynamic(() => import("./graficos").then((m) => m.GraficoSaldo), {
  ssr: false,
  loading: () => <Reserva altura={260} />,
});
export const DonutCategorias = dynamic(() => import("./graficos").then((m) => m.DonutCategorias), {
  ssr: false,
  loading: () => <Reserva altura={200} />,
});
export const PrevistoPagoMes = dynamic(() => import("./graficos").then((m) => m.PrevistoPagoMes), {
  ssr: false,
  loading: () => <Reserva altura={160} />,
});
