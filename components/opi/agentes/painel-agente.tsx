"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Badge, type BadgeTone } from "@/components/opi";
import { STATUS_LABEL, membroPorId } from "@/lib/opi/agentes";
import { historicoRecente, iniciais } from "@/lib/opi/agentes-dados";

export interface PedidoAgenteView {
  id: string;
  agente: string;
  mensagem: string;
  status: "NOVO" | "EM_ANDAMENTO" | "FEITO" | "ERRO";
  resposta: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS: Record<PedidoAgenteView["status"], { label: string; tone: BadgeTone }> = {
  NOVO: { label: "Na fila", tone: "neutral" },
  EM_ANDAMENTO: { label: "Em andamento", tone: "success" },
  FEITO: { label: "Feito", tone: "success" },
  ERRO: { label: "Erro", tone: "error" },
};

const POLL_MS = 5000;

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

interface PainelAgenteProps {
  agente: string;
  onFechar: () => void;
  /** Chamado a cada atualização (envio ou polling) para o mapa refazer o resumo. */
  onAtividade: () => void;
}

/** Painel lateral: quem é, últimos pedidos e uma caixa para mandar um pedido novo. */
export function PainelAgente({ agente, onFechar, onAtividade }: PainelAgenteProps) {
  const membro = membroPorId(agente);
  const nome = membro?.nome ?? agente;
  const [pedidos, setPedidos] = useState<PedidoAgenteView[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const caixaRef = useRef<HTMLTextAreaElement>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`/api/agentes?agente=${encodeURIComponent(agente)}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const json = (await res.json()) as { data: PedidoAgenteView[] };
      setPedidos(json.data);
      setErro(null);
    } catch {
      setErro("Não foi possível carregar os pedidos.");
    } finally {
      setCarregado(true);
    }
  }, [agente]);

  // Polling de 5 s só enquanto o painel está aberto (o componente só existe aberto e é remontado por agente).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial; o setState acontece depois do fetch
    void carregar();
    const timer = setInterval(() => {
      void carregar();
      onAtividade();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [carregar, onAtividade]);

  useEffect(() => {
    caixaRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [agente, onFechar]);

  async function enviar(event?: FormEvent) {
    event?.preventDefault();
    const mensagem = texto.trim();
    if (!mensagem || enviando) return;
    setEnviando(true);
    setErro(null);
    const agora = new Date().toISOString();
    const temp: PedidoAgenteView = { id: `temp-${agora}`, agente, mensagem, status: "NOVO", resposta: null, createdAt: agora, updatedAt: agora };
    setPedidos((atual) => [...atual, temp]);
    setTexto("");
    try {
      const res = await fetch("/api/agentes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agente, mensagem }),
      });
      if (!res.ok) throw new Error();
      const json = (await res.json()) as { data: PedidoAgenteView };
      setPedidos((atual) => atual.map((p) => (p.id === temp.id ? json.data : p)));
      onAtividade();
    } catch {
      setPedidos((atual) => atual.filter((p) => p.id !== temp.id));
      setTexto(mensagem);
      setErro("Não foi possível enviar. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  const recentes = historicoRecente(pedidos, 8);

  return (
    <div className="fixed inset-0 z-[90]" role="presentation">
      <button type="button" aria-label="Fechar painel" onClick={onFechar} className="absolute inset-0 h-full w-full cursor-default bg-[#111217]/25 backdrop-blur-[2px]" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="painel-agente-titulo"
        className="absolute inset-y-0 right-0 flex w-full max-w-[26rem] flex-col overflow-hidden border-l border-[#111217]/10 bg-[#f4f6f8] text-[#111217] shadow-[0_30px_80px_-20px_rgba(17,18,23,.45)] sm:inset-y-3 sm:right-3 sm:rounded-[24px] sm:border"
      >
        <header className="relative flex items-start gap-3 border-b border-[#111217]/8 p-5">
          <span aria-hidden className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-[#D9541E]/85 to-transparent" />
          <span aria-hidden className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[#111217] font-display text-sm font-extrabold text-white">
            {iniciais(nome)}
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="painel-agente-titulo" className="font-display text-lg font-extrabold leading-tight">{nome}</h2>
            <p className="text-sm text-muted">{membro?.papel}</p>
            {membro?.status && <p className="mt-1 text-xs text-muted">{STATUS_LABEL[membro.status]}</p>}
          </div>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[#111217]/10 bg-white text-muted hover:text-foreground">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden><path d="M6 6l12 12M18 6 6 18" /></svg>
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-5">
          <p className="opi-label mb-3">Últimos pedidos</p>
          {!carregado && <p className="text-sm text-muted">Carregando…</p>}
          {carregado && recentes.length === 0 && (
            <div className="opi-inset px-4 py-6 text-center">
              <p className="text-sm font-semibold">Nenhum pedido para {nome} ainda.</p>
              <p className="mt-1 text-xs text-muted">O que você mandar aqui aparece nesta lista com o andamento.</p>
            </div>
          )}
          <ul className="space-y-2">
            {recentes.map((p) => (
              <li key={p.id} className="rounded-2xl border border-[#111217]/8 bg-white/70 px-3.5 py-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="line-clamp-3 whitespace-pre-wrap break-words text-sm">{p.mensagem}</p>
                  <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                </div>
                <p className="mt-1 text-[11px] text-muted">{quando(p.createdAt)}</p>
                {p.resposta && (
                  <details className="mt-2 rounded-xl bg-[#111217]/[.04] px-3 py-2 text-sm">
                    <summary className="cursor-pointer text-xs font-semibold text-[#D9541E]">Ver resposta</summary>
                    <p className="mt-2 whitespace-pre-wrap break-words">{p.resposta}</p>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </div>

        <form onSubmit={enviar} className="border-t border-[#111217]/8 p-5">
          <label htmlFor="painel-agente-msg" className="opi-label mb-2">Mandar para {nome}</label>
          <textarea
            id="painel-agente-msg"
            ref={caixaRef}
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void enviar();
            }}
            maxLength={4000}
            rows={3}
            placeholder={`O que ${nome} deve fazer?`}
            className="w-full resize-none border border-[#111217]/12 px-3.5 py-2.5 text-sm placeholder:text-muted focus:border-[#D9541E] focus:outline-none"
          />
          <div className="mt-2 flex items-center justify-between gap-3">
            <p className="text-[11px] leading-snug text-muted">Quem responde é o runner no seu PC (confere a cada minuto).</p>
            <button
              type="submit"
              disabled={enviando || !texto.trim()}
              className="shrink-0 rounded-full bg-[#D9541E] px-5 py-2 text-sm font-semibold text-white shadow-[0_0_18px_rgba(217,84,30,.4)] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              {enviando ? "Enviando…" : "Enviar"}
            </button>
          </div>
          {erro && <p className="mt-2 text-xs text-error">{erro}</p>}
        </form>
      </aside>
    </div>
  );
}
