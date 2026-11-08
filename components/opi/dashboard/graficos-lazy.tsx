"use client";

// Gráficos do Dashboard com import dinâmico: o recharts só baixa depois que a página já apareceu.
// A página (servidor) continua passando os mesmos dados; enquanto o gráfico chega, fica um cartão de
// vidro do mesmo tamanho no lugar, sem pular o layout.
import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type * as G from "./graficos";

function Reserva() {
  return (
    <section aria-hidden className="opi-glass flex min-h-[340px] min-w-0 flex-col gap-4 p-[22px]">
      <div className="h-4 w-40 animate-pulse rounded-full bg-[#111217]/[0.06]" />
      <div className="h-3 w-64 max-w-full animate-pulse rounded-full bg-[#111217]/[0.05]" />
      <div className="flex-1 animate-pulse rounded-2xl bg-[#111217]/[0.05]" />
    </section>
  );
}

const Seguidores = dynamic(() => import("./graficos").then((m) => m.GraficoSeguidores), {
  ssr: false,
  loading: () => <Reserva />,
});
const Audiencia = dynamic(() => import("./graficos").then((m) => m.GraficoAudiencia), {
  ssr: false,
  loading: () => <Reserva />,
});
const Dms = dynamic(() => import("./graficos").then((m) => m.GraficoDms), {
  ssr: false,
  loading: () => <Reserva />,
});
const Palavras = dynamic(() => import("./graficos").then((m) => m.GraficoPalavras), {
  ssr: false,
  loading: () => <Reserva />,
});
const Horario = dynamic(() => import("./graficos").then((m) => m.GraficoHorario), {
  ssr: false,
  loading: () => <Reserva />,
});

// O className (ex.: lg:col-span-2) fica num invólucro, para valer também enquanto o gráfico carrega.
function Envolve({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={`grid min-w-0 ${className ?? ""}`}>{children}</div>;
}

export function GraficoSeguidores({ className, ...p }: ComponentProps<typeof G.GraficoSeguidores>) {
  return (
    <Envolve className={className}>
      <Seguidores {...p} />
    </Envolve>
  );
}
export function GraficoAudiencia({ className, ...p }: ComponentProps<typeof G.GraficoAudiencia>) {
  return (
    <Envolve className={className}>
      <Audiencia {...p} />
    </Envolve>
  );
}
export function GraficoDms({ className, ...p }: ComponentProps<typeof G.GraficoDms>) {
  return (
    <Envolve className={className}>
      <Dms {...p} />
    </Envolve>
  );
}
export function GraficoPalavras({ className, ...p }: ComponentProps<typeof G.GraficoPalavras>) {
  return (
    <Envolve className={className}>
      <Palavras {...p} />
    </Envolve>
  );
}
export function GraficoHorario({ className, ...p }: ComponentProps<typeof G.GraficoHorario>) {
  return (
    <Envolve className={className}>
      <Horario {...p} />
    </Envolve>
  );
}
