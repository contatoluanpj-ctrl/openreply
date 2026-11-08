// Peças do Dashboard no estilo do Painel OPI: KPI (opi-tile), card de plataforma (.opi-plat) e pendências (.opi-pend).
import Link from "next/link";
import type { ReactNode } from "react";
import { RedeIcone } from "@/components/opi/redes/rede-icone";
import type { CardPlataforma } from "@/lib/opi/dashboard-dados";
import type { Pendencia } from "@/lib/opi/visao-geral";
import { areaDaPendencia } from "@/lib/opi/dashboard-dados";
import { deltaTexto, valorFormatado } from "./formato";
import { Icone, type IconeNome } from "./icones";

export function Delta({ valor, pp = false }: { valor: number | null | undefined; pp?: boolean }) {
  if (valor === null || valor === undefined) return null;
  return <span className={`opi-delta ${valor >= 0 ? "up" : "down"}`}>{deltaTexto(valor, pp)}</span>;
}

export function Kpi({
  icone,
  rotulo,
  valor,
  delta,
  pp,
  dica,
  href,
}: {
  icone: IconeNome;
  rotulo: string;
  valor: ReactNode;
  delta?: number | null;
  pp?: boolean;
  dica: ReactNode;
  href?: string;
}) {
  const corpo = (
    <>
      <p className="opi-label">
        <Icone nome={icone} />
        {rotulo}
      </p>
      <div className="mt-1.5 flex items-baseline gap-2">
        <span className="opi-num text-[26px] leading-tight">{valor}</span>
        <Delta valor={delta} pp={pp} />
      </div>
      <p className="mt-0.5 text-xs text-muted">{dica}</p>
    </>
  );
  return href ? (
    <Link href={href} className="opi-tile block transition-transform hover:-translate-y-0.5">
      {corpo}
    </Link>
  ) : (
    <div className="opi-tile">{corpo}</div>
  );
}

const fmtColeta = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

function Estado({ estado }: { estado: string }) {
  const ok = estado === "conectado" || estado === "ok";
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${
        ok ? "border-[rgba(217,84,30,.45)] bg-[rgba(217,84,30,.1)] text-accent" : "border-border bg-white/40 text-muted"
      }`}
    >
      {ok && <span className="h-[7px] w-[7px] animate-pulse rounded-full bg-accent motion-reduce:animate-none" aria-hidden />}
      {ok ? "Ao vivo" : estado === "sem_dados" ? "Sem dados" : estado === "sem_conta" ? "Sem conta" : estado}
    </span>
  );
}

export function Plataforma({ card }: { card: CardPlataforma }) {
  return (
    <article className="opi-glass flex w-full flex-col p-5 sm:w-[min(100%,24rem)]">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 flex-none place-items-center rounded-2xl border border-[rgba(17,18,23,.06)] bg-white/70">
            <RedeIcone rede={card.rede} className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <h3 className="font-display text-base font-bold text-foreground">{card.nome}</h3>
            <p className="truncate text-xs text-muted">
              {card.coletadoEm ? `Coletado em ${fmtColeta.format(card.coletadoEm)}` : "Sem data de coleta"}
            </p>
          </div>
        </div>
        <Estado estado={card.estado} />
      </div>

      <div className="mt-5">
        <p className="opi-label">
          <Icone nome={card.destaque.formato === "brl" ? "coin" : "users"} />
          {card.destaque.rotulo}
        </p>
        <div className="mt-1.5 flex items-end gap-2.5">
          <span className="opi-num text-[44px] leading-none [text-shadow:0_0_32px_rgba(217,84,30,.25)]">
            {valorFormatado(card.destaque.valor, card.destaque.formato)}
          </span>
          <span className="pb-1">
            <Delta valor={card.destaque.delta} />
          </span>
        </div>
      </div>

      {card.stats.length > 0 ? (
        <div className="mt-5 grid grid-cols-2 gap-2">
          {card.stats.map((s) => (
            <div key={s.rotulo} className="opi-inset min-w-0 px-3 py-2.5">
              <p className="truncate text-xs text-muted">{s.rotulo}</p>
              <div className="mt-1 flex flex-wrap items-center gap-1.5">
                <span className="opi-num text-xl leading-none">{valorFormatado(s.valor, s.formato)}</span>
                <Delta valor={s.delta} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-5 rounded-xl border border-dashed border-border px-3 py-2.5 text-xs leading-relaxed text-muted">
          Só o número principal foi coletado. As outras métricas aparecem quando o coletor enviar.
        </p>
      )}
    </article>
  );
}

export function Pendencias({ itens }: { itens: Pendencia[] }) {
  if (itens.length === 0) {
    return (
      <p className="opi-tile flex items-center gap-2 text-sm text-muted">
        <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
        Nada pendente. Tudo em dia.
      </p>
    );
  }
  return (
    <ul className="grid gap-2">
      {itens.map((p, i) => (
        <li key={`${p.href}-${i}`}>
          <Link
            href={p.href}
            className="opi-tile grid grid-cols-1 items-center gap-1.5 transition-colors hover:bg-white/80 sm:grid-cols-[7rem_1fr_auto] sm:gap-3"
          >
            <span className="text-[11px] uppercase tracking-[.08em] text-muted">{areaDaPendencia(p.href)}</span>
            <span className="flex min-w-0 items-center gap-2 text-sm text-foreground">
              <span className={`h-2 w-2 shrink-0 rounded-full ${p.nivel === "erro" ? "bg-error" : "bg-muted"}`} aria-hidden />
              <span>{p.texto}</span>
            </span>
            <span className="text-xs font-semibold text-accent">Abrir →</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
