"use client";

// Interruptor "Publicação automática" do Calendário. Ligar não aprova nada: o publicador só publica
// post APROVADO (calendário aprovado pelo Luan, D-0026) e com o aviso obrigatório na legenda.
import { useEffect, useState } from "react";
import { confirmar } from "@/lib/opi/confirmar";
import type { EstadoPublicador } from "@/app/api/opi/publicador/route";

const fmtQuando = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function ChavePublicador() {
  const [estado, setEstado] = useState<EstadoPublicador | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    fetch("/api/opi/publicador", { cache: "no-store" })
      .then(async (r) => {
        const dados = (await r.json().catch(() => ({}))) as EstadoPublicador & { error?: string };
        if (!r.ok) throw new Error(dados.error ?? "Não foi possível ler a chave");
        if (vivo) setEstado(dados);
      })
      .catch((e: unknown) => vivo && setErro(e instanceof Error ? e.message : "Não foi possível ler a chave"));
    return () => {
      vivo = false;
    };
  }, []);

  async function alternar() {
    if (!estado || salvando) return;
    const ligar = !estado.ligado;
    const pergunta = ligar
      ? "Ligar a publicação automática? Os posts APROVADOS e com o aviso na legenda serão publicados sozinhos na data e hora marcadas."
      : "Desligar a publicação automática? Nada mais será publicado sozinho até você ligar de novo.";
    if (!(await confirmar(pergunta))) return;
    setSalvando(true);
    setErro(null);
    try {
      const r = await fetch("/api/opi/publicador", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ligado: ligar }),
      });
      const dados = (await r.json().catch(() => ({}))) as EstadoPublicador & { error?: string };
      if (!r.ok) throw new Error(dados.error ?? "Não foi possível mudar a chave");
      setEstado(dados);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível mudar a chave");
    } finally {
      setSalvando(false);
    }
  }

  const ligado = estado?.ligado ?? false;
  const desabilitado = !estado || salvando || !estado.podeAlterar;

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-2xl border border-border bg-white/40 px-3 py-2">
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        aria-label="Publicação automática"
        disabled={desabilitado}
        onClick={alternar}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition disabled:cursor-not-allowed disabled:opacity-50 ${
          ligado ? "border-accent bg-accent shadow-[0_0_14px_rgba(217,84,30,0.45)]" : "border-[#111217]/15 bg-[#111217]/10"
        }`}
      >
        <span
          aria-hidden
          className={`inline-block h-4.5 w-4.5 rounded-full bg-white shadow transition-transform ${ligado ? "translate-x-5.5" : "translate-x-0.5"}`}
        />
      </button>
      <div className="min-w-0 text-sm leading-tight">
        <p className="font-semibold text-foreground">
          Publicação automática:{" "}
          <span className={ligado ? "text-accent" : "text-muted"}>
            {estado ? (ligado ? "ligada" : "desligada") : "…"}
          </span>
        </p>
        <p className="text-xs text-muted">
          {ligado
            ? "Publica sozinho só o que estiver Aprovado e com o aviso na legenda."
            : "O painel não libera nenhuma publicação sozinha. Aprovar o calendário não publica enquanto estiver desligada."}
          {estado?.alteradoEm && (
            <> · alterada em {fmtQuando.format(new Date(estado.alteradoEm))}{estado.alteradoPor ? ` por ${estado.alteradoPor}` : ""}</>
          )}
        </p>
        {estado && ligado && !estado.contaConectada && (
          <p className="text-xs text-error">
            A conta do Instagram que publica não está conectada neste workspace: nada será publicado.
          </p>
        )}
        {estado && !estado.podeAlterar && <p className="text-xs text-muted">Só administradores mudam esta chave.</p>}
        {erro && <p className="text-xs text-error">{erro}</p>}
      </div>
    </div>
  );
}
