"use client";

// Peças dos gráficos do Financeiro que não dependem do recharts (cores, rótulos, cabeçalho, legenda,
// estado vazio). Ficam fora de graficos.tsx para o painel carregar o recharts só quando desenha.
import type { ReactNode } from "react";

export const COR = {
  principal: "#D9541E",
  secundaria: "#111217",
  terciaria: "rgba(17,18,23,.35)",
  grade: "rgba(17,18,23,.08)",
  eixo: "rgba(17,18,23,.5)",
};

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function rotuloMes(mes: string, comAno = false) {
  const [ano, m] = mes.split("-");
  return comAno ? `${MESES[Number(m) - 1]}/${ano.slice(2)}` : MESES[Number(m) - 1];
}

/** Cabeçalho de gráfico do artefato: título, frase "o que olhar" e controle opcional à direita. */
export function CabecalhoGrafico({ titulo, olhar, controle }: { titulo: string; olhar: string; controle?: ReactNode }) {
  return (
    <div className="mb-[18px] flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="font-display text-base font-bold text-foreground">{titulo}</h3>
        <p className="mt-[3px] text-xs text-muted">{olhar}</p>
      </div>
      {controle}
    </div>
  );
}

/** Estado vazio centrado, como o .opi-empty do artefato. */
export function Vazio({ titulo, texto, altura = 240 }: { titulo: string; texto: string; altura?: number }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 text-center" style={{ minHeight: altura }}>
      <svg viewBox="0 0 24 24" className="h-7 w-7 text-accent" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
        <path d="M3 3v18h18" strokeLinecap="round" />
        <path d="M7 15l4-4 3 3 5-6" strokeLinecap="round" strokeLinejoin="round" strokeDasharray="3 3" />
      </svg>
      <b className="mt-2.5 text-sm text-foreground/80">{titulo}</b>
      <small className="mt-1 max-w-[22rem] text-xs leading-relaxed text-muted">{texto}</small>
    </div>
  );
}

export function Legenda({ itens }: { itens: { cor: string; nome: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted">
      {itens.map((i) => (
        <span key={i.nome} className="flex items-center gap-1.5">
          <i className="inline-block h-[3px] w-4 rounded" style={{ background: i.cor }} />
          {i.nome}
        </span>
      ))}
    </div>
  );
}
