"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Badge, type BadgeTone } from "@/components/opi";
import { AGENTES_IDS, nomeDoAgente, membroPorId } from "@/lib/opi/agentes";

type Status = "NOVO" | "EM_ANDAMENTO" | "FEITO" | "ERRO";
interface PedidoView {
  id: string;
  agente: string;
  mensagem: string;
  status: Status;
  resposta: string | null;
  anexos: { grupo?: string; pedidoOriginal?: string } | null;
  createdAt: string;
}
interface Sugestao {
  responsavel: string;
  confianca: number;
  ranking: { id: string; nome: string; p: number }[];
  destinos: string[];
  motivo: string;
}

const STATUS: Record<Status, { label: string; tone: BadgeTone }> = {
  NOVO: { label: "Na fila", tone: "neutral" },
  EM_ANDAMENTO: { label: "Trabalhando", tone: "success" },
  FEITO: { label: "Feito", tone: "success" },
  ERRO: { label: "Erro", tone: "error" },
};
const POLL_MS = 5000;
const EXEMPLOS = [
  "Quero começar a criar a área da comunidade",
  "Muda a cena do início do vídeo 03",
  "Agenda o Reel 07 para quinta às 18h",
  "Quanto estamos gastando com ferramentas?",
];

function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

/** Chat central: o Luan escreve o que quer, o Jev sugere quem faz, ele confirma e o pedido vai para a fila do agente. */
export function ChatCentral() {
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [pendente, setPendente] = useState<{ mensagem: string; sugestao: Sugestao | null; ledgerId: string | null } | null>(null);
  const [destinos, setDestinos] = useState<string[]>([]);
  const [pedidos, setPedidos] = useState<PedidoView[]>([]);
  const [carregado, setCarregado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const caixaRef = useRef<HTMLTextAreaElement>(null);

  const carregar = useCallback(async () => {
    try {
      const res = await fetch("/api/opi/roteador", { cache: "no-store" });
      if (!res.ok) throw new Error();
      setPedidos(((await res.json()) as { data: PedidoView[] }).data);
    } catch {
      /* mantém a lista anterior */
    } finally {
      setCarregado(true);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial; o setState acontece depois do fetch
    void carregar();
    const t = setInterval(() => void carregar(), POLL_MS);
    return () => clearInterval(t);
  }, [carregar]);

  async function sugerir(event?: FormEvent) {
    event?.preventDefault();
    const mensagem = texto.trim();
    if (!mensagem || pensando) return;
    setPensando(true);
    setErro(null);
    try {
      const res = await fetch("/api/opi/roteador", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ acao: "sugerir", mensagem }),
      });
      if (!res.ok) throw new Error();
      const { data } = (await res.json()) as { data: { sugestao: Sugestao | null; ledgerId: string | null } };
      setPendente({ mensagem, sugestao: data.sugestao, ledgerId: data.ledgerId });
      setDestinos(data.sugestao?.destinos ?? ["ceo"]);
    } catch {
      setErro("Não consegui analisar o pedido. Tente de novo.");
    } finally {
      setPensando(false);
    }
  }

  async function enviar() {
    if (!pendente || destinos.length === 0 || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      const res = await fetch("/api/opi/roteador", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          acao: "enviar",
          mensagem: pendente.mensagem,
          destinos,
          sugeridos: pendente.sugestao?.destinos ?? [],
          ...(pendente.ledgerId ? { ledgerId: pendente.ledgerId } : {}),
        }),
      });
      if (!res.ok) throw new Error();
      setPendente(null);
      setTexto("");
      setDestinos([]);
      await carregar();
      caixaRef.current?.focus();
    } catch {
      setErro("Não foi possível enviar. Tente de novo.");
    } finally {
      setEnviando(false);
    }
  }

  function alternar(id: string) {
    setDestinos((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id]));
  }

  // Agrupa os pedidos pelo envio (um envio pode ir a vários agentes).
  const conversas = useMemo(() => {
    const mapa = new Map<string, { original: string; createdAt: string; itens: PedidoView[] }>();
    for (const p of pedidos) {
      const g = p.anexos?.grupo ?? p.id;
      const c = mapa.get(g) ?? { original: p.anexos?.pedidoOriginal ?? p.mensagem, createdAt: p.createdAt, itens: [] };
      c.itens.push(p);
      mapa.set(g, c);
    }
    return [...mapa.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [pedidos]);

  const outros = AGENTES_IDS.filter((id) => !destinos.includes(id));

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
      <section className="opi-glass p-5 sm:p-6">
        <form onSubmit={sugerir}>
          <label htmlFor="chat-central" className="opi-label mb-2">O que você quer fazer?</label>
          <textarea
            id="chat-central"
            ref={caixaRef}
            value={texto}
            onChange={(e) => { setTexto(e.target.value); if (pendente) setPendente(null); }}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void sugerir(); }}
            rows={4}
            maxLength={4000}
            placeholder="Escreva do seu jeito. Ex.: quero começar a criar a área da comunidade."
            className="w-full resize-none rounded-2xl border border-[#111217]/12 bg-white/80 px-4 py-3 text-[15px] placeholder:text-muted focus:border-[#D9541E] focus:outline-none"
          />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {EXEMPLOS.map((ex) => (
              <button key={ex} type="button" onClick={() => { setTexto(ex); setPendente(null); }}
                className="rounded-full border border-[#111217]/10 bg-white/60 px-3 py-1 text-xs text-muted hover:text-foreground">
                {ex}
              </button>
            ))}
          </div>
          {!pendente && (
            <div className="mt-4 flex justify-end">
              <button type="submit" disabled={pensando || !texto.trim()}
                className="rounded-full bg-[#111217] px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40">
                {pensando ? "Vendo quem faz…" : "Encaminhar"}
              </button>
            </div>
          )}
        </form>

        {pendente && (
          <div className="mt-5 rounded-2xl border border-[#D9541E]/30 bg-[#D9541E]/[.05] p-4">
            <p className="opi-label">Vai para</p>
            <p className="mt-1 text-xs text-muted">
              {pendente.sugestao ? `Sugestão do Jev: ${pendente.sugestao.motivo}` : "O Jev não respondeu: escolha quem faz (padrão: CEO)."}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {destinos.map((id) => (
                <button key={id} type="button" onClick={() => alternar(id)} title="Tirar"
                  className="inline-flex items-center gap-1.5 rounded-full bg-[#111217] px-3 py-1.5 text-sm font-semibold text-white">
                  {nomeDoAgente(id)} <span aria-hidden className="text-white/60">×</span>
                </button>
              ))}
              <select aria-label="Adicionar agente" value="" onChange={(e) => e.target.value && alternar(e.target.value)}
                className="rounded-full border border-[#111217]/12 bg-white px-3 py-1.5 text-sm">
                <option value="">+ adicionar</option>
                {outros.map((id) => <option key={id} value={id}>{nomeDoAgente(id)} — {membroPorId(id)?.papel}</option>)}
              </select>
            </div>
            {pendente.sugestao && pendente.sugestao.ranking.length > 1 && (
              <p className="mt-2 text-[11px] text-muted">
                Também cogitados: {pendente.sugestao.ranking.slice(1).map((r) => `${r.nome} ${Math.round(r.p * 100)}%`).join(" · ")}
              </p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button type="button" onClick={() => setPendente(null)} className="rounded-full px-4 py-2 text-sm text-muted hover:text-foreground">Cancelar</button>
              <button type="button" onClick={() => void enviar()} disabled={enviando || destinos.length === 0}
                className="rounded-full bg-[#D9541E] px-5 py-2 text-sm font-semibold text-white shadow-[0_0_18px_rgba(217,84,30,.4)] hover:opacity-90 disabled:opacity-40">
                {enviando ? "Enviando…" : destinos.length > 1 ? `Enviar para ${destinos.length}` : "Enviar"}
              </button>
            </div>
          </div>
        )}
        {erro && <p className="mt-3 text-xs text-error">{erro}</p>}
        <p className="mt-4 text-[11px] leading-snug text-muted">
          Quem executa é o runner no seu PC (confere a fila a cada minuto). A resposta aparece aqui ao lado.
        </p>
      </section>

      <section className="opi-glass p-5 sm:p-6">
        <p className="opi-label mb-3">Pedidos do chat</p>
        {!carregado && <p className="text-sm text-muted">Carregando…</p>}
        {carregado && conversas.length === 0 && (
          <div className="opi-inset px-4 py-6 text-center">
            <p className="text-sm font-semibold">Nenhum pedido ainda.</p>
            <p className="mt-1 text-xs text-muted">O que você encaminhar aparece aqui, com quem pegou e a resposta.</p>
          </div>
        )}
        <ul className="space-y-3">
          {conversas.map((c, i) => (
            <li key={i} className="rounded-2xl border border-[#111217]/8 bg-white/70 p-3.5">
              <p className="whitespace-pre-wrap break-words text-sm font-medium">{c.original}</p>
              <p className="mt-1 text-[11px] text-muted">{quando(c.createdAt)}</p>
              <ul className="mt-2 space-y-1.5">
                {c.itens.map((p) => (
                  <li key={p.id} className="rounded-xl bg-[#111217]/[.04] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{nomeDoAgente(p.agente)}</span>
                      <Badge tone={STATUS[p.status].tone}>{STATUS[p.status].label}</Badge>
                    </div>
                    {p.resposta && (
                      <details className="mt-1 text-sm">
                        <summary className="cursor-pointer text-xs font-semibold text-[#D9541E]">Ver resposta</summary>
                        <p className="mt-2 whitespace-pre-wrap break-words">{p.resposta}</p>
                      </details>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
