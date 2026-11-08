"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Badge, type BadgeTone } from "@/components/opi";
import { nomeDoAgente } from "@/lib/opi/agentes";

export interface PedidoChat {
  id: string;
  agente: string;
  mensagem: string;
  status: "NOVO" | "EM_ANDAMENTO" | "FEITO" | "ERRO";
  resposta: string | null;
  createdAt: string;
  updatedAt: string;
}

const STATUS: Record<PedidoChat["status"], { label: string; tone: BadgeTone }> = {
  NOVO: { label: "Na fila", tone: "neutral" },
  EM_ANDAMENTO: { label: "Em andamento", tone: "neutral" },
  FEITO: { label: "Feito", tone: "success" },
  ERRO: { label: "Erro", tone: "error" },
};

const POLL_MS = 5000;

function hora(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

export function ChatAgente({ agente, onAtividade }: { agente: string; onAtividade?: () => void }) {
  const [pedidos, setPedidos] = useState<PedidoChat[]>([]);
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [carregado, setCarregado] = useState(false);
  const fimRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch(`/api/agentes?agente=${encodeURIComponent(agente)}`, { cache: "no-store" });
      if (!res.ok) throw new Error();
      const json = (await res.json()) as { data: PedidoChat[] };
      setPedidos(json.data);
      setErro(null);
    } catch {
      setErro("Não foi possível carregar as mensagens.");
    } finally {
      setCarregado(true);
    }
  }, [agente]);

  useEffect(() => {
    setPedidos([]);
    setCarregado(false);
    void carregar();
    const timer = setInterval(() => void carregar(), POLL_MS);
    return () => clearInterval(timer);
  }, [carregar]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ block: "nearest" });
  }, [pedidos.length]);

  async function enviar(event: FormEvent) {
    event.preventDefault();
    const mensagem = texto.trim();
    if (!mensagem || enviando) return;
    setEnviando(true);
    setErro(null);
    const agora = new Date().toISOString();
    const temp: PedidoChat = { id: `temp-${agora}`, agente, mensagem, status: "NOVO", resposta: null, createdAt: agora, updatedAt: agora };
    setPedidos((atual) => [...atual, temp]);
    setTexto("");
    try {
      const res = await fetch("/api/agentes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agente, mensagem }),
      });
      if (!res.ok) throw new Error();
      const json = (await res.json()) as { data: PedidoChat };
      setPedidos((atual) => atual.map((p) => (p.id === temp.id ? json.data : p)));
      onAtividade?.();
    } catch {
      setPedidos((atual) => atual.filter((p) => p.id !== temp.id));
      setTexto(mensagem);
      setErro("Não foi possível enviar. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="max-h-[28rem] min-h-[12rem] space-y-4 overflow-y-auto rounded-md border border-border bg-background p-3">
        {carregado && pedidos.length === 0 && (
          <p className="py-8 text-center text-sm text-muted">
            Nenhum pedido para {nomeDoAgente(agente)} ainda.
          </p>
        )}
        {pedidos.map((p) => (
          <div key={p.id} className="space-y-2">
            <div className="flex justify-end">
              <div className="max-w-[85%] rounded-lg bg-surface-hover px-3 py-2">
                <p className="whitespace-pre-wrap break-words text-sm text-foreground">{p.mensagem}</p>
                <div className="mt-1 flex items-center justify-end gap-2">
                  <span className="text-[11px] text-muted">{hora(p.createdAt)}</span>
                  <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                </div>
              </div>
            </div>
            {p.resposta && (
              <div className="flex justify-start">
                <div className={`max-w-[85%] rounded-lg border px-3 py-2 ${p.status === "ERRO" ? "border-error/30" : "border-border"} bg-surface`}>
                  <p className="mb-1 text-[11px] font-medium text-muted">{nomeDoAgente(p.agente)}</p>
                  <p className="whitespace-pre-wrap break-words text-sm text-foreground">{p.resposta}</p>
                  <p className="mt-1 text-[11px] text-muted">{hora(p.updatedAt)}</p>
                </div>
              </div>
            )}
          </div>
        ))}
        <div ref={fimRef} />
      </div>

      <form onSubmit={enviar} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <label className="sr-only" htmlFor={`msg-${agente}`}>Mensagem para {nomeDoAgente(agente)}</label>
        <textarea
          id={`msg-${agente}`}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void enviar(e as unknown as FormEvent);
          }}
          maxLength={4000}
          rows={3}
          placeholder={`Pedido para ${nomeDoAgente(agente)}…`}
          className="min-h-[4.5rem] flex-1 resize-y rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-border-hover focus:outline-none"
        />
        <button
          type="submit"
          disabled={enviando || !texto.trim()}
          className="rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          {enviando ? "Enviando…" : "Enviar"}
        </button>
      </form>
      {erro && <p className="text-xs text-error">{erro}</p>}
      <p className="text-xs text-muted">
        O pedido entra na fila e o runner local no seu PC responde (confere a cada minuto). Ctrl+Enter envia.
      </p>
    </div>
  );
}
