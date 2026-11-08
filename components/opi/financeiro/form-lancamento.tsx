"use client";

import { useState, type FormEvent } from "react";
import type { LancamentoJson, Status, Tipo } from "@/lib/opi/financeiro";

const CAMPO =
  "h-10 w-full rounded-xl border border-border bg-white/70 px-3.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";
const ROTULO = "grid gap-1.5 text-[11px] font-semibold uppercase tracking-[.1em] text-muted";

function Seg<T extends string>({ valor, opcoes, onChange, rotulo }: { valor: T; opcoes: [T, string][]; onChange: (v: T) => void; rotulo: string }) {
  return (
    <div className="opi-seg w-fit normal-case tracking-normal" role="group" aria-label={rotulo}>
      {opcoes.map(([v, nome]) => (
        <button key={v} type="button" aria-pressed={valor === v} onClick={() => onChange(v)}>
          {nome}
        </button>
      ))}
    </div>
  );
}

export interface FormLancamentoProps {
  /** Quando vier, o formulário edita esse lançamento (PATCH); senão cria (POST). */
  editando?: LancamentoJson | null;
  onSalvo: () => void;
  onCancelar?: () => void;
}

function hojeISO() {
  return new Date().toISOString().slice(0, 10);
}

export function FormLancamento({ editando, onSalvo, onCancelar }: FormLancamentoProps) {
  const [data, setData] = useState(editando ? editando.data.slice(0, 10) : hojeISO());
  const [tipo, setTipo] = useState<Tipo>(editando?.tipo ?? "DESPESA");
  const [categoria, setCategoria] = useState(editando?.categoria ?? "");
  const [descricao, setDescricao] = useState(editando?.descricao ?? "");
  const [valor, setValor] = useState(editando ? editando.valor.replace(".", ",") : "");
  const [status, setStatus] = useState<Status>(editando?.status ?? "PREVISTO");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    setSalvando(true);
    setErro(null);
    try {
      const url = editando ? `/api/opi/financeiro/${editando.id}` : "/api/opi/financeiro";
      const res = await fetch(url, {
        method: editando ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data, tipo, categoria, descricao, valor, status }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        setErro(json?.error ?? "Não foi possível salvar.");
        return;
      }
      if (!editando) {
        setCategoria("");
        setDescricao("");
        setValor("");
      }
      onSalvo();
    } catch {
      setErro("Falha de conexão. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <form onSubmit={enviar} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <label className={ROTULO}>
        Data
        <input type="date" required value={data} onChange={(e) => setData(e.target.value)} className={CAMPO} />
      </label>
      <div className={ROTULO}>
        Tipo
        <Seg rotulo="Tipo" valor={tipo} onChange={setTipo} opcoes={[["DESPESA", "Despesa"], ["RECEITA", "Receita"]]} />
      </div>
      <div className={ROTULO}>
        Status
        <Seg rotulo="Status" valor={status} onChange={setStatus} opcoes={[["PREVISTO", "Previsto"], ["PAGO", "Pago"]]} />
      </div>
      <label className={ROTULO}>
        Categoria
        <input
          required
          maxLength={60}
          value={categoria}
          onChange={(e) => setCategoria(e.target.value)}
          placeholder="Ferramentas IA"
          className={CAMPO}
        />
      </label>
      <label className={ROTULO}>
        Descrição
        <input
          required
          maxLength={200}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Assinatura mensal"
          className={CAMPO}
        />
      </label>
      <label className={ROTULO}>
        Valor (R$)
        <input
          required
          inputMode="decimal"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          placeholder="149,00"
          className={CAMPO}
        />
      </label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2 lg:col-span-3">
        <button
          type="submit"
          disabled={salvando}
          className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground shadow-[0_0_18px_rgba(217,84,30,.4)] hover:bg-accent-hover disabled:opacity-50"
        >
          {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Adicionar lançamento"}
        </button>
        {editando && onCancelar && (
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-full border border-border bg-white/50 px-5 py-2.5 text-sm font-semibold text-foreground/80 hover:bg-white/80"
          >
            Cancelar
          </button>
        )}
        {erro && (
          <p role="alert" className="text-sm text-error">
            {erro}
          </p>
        )}
      </div>
    </form>
  );
}
