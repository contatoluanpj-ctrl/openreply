"use client";

import { useState, type FormEvent } from "react";
import type { LancamentoJson, Status, Tipo } from "@/lib/opi/financeiro";

const CAMPO =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-border-hover focus:outline-none";

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
    <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <label className="grid gap-1 text-xs text-muted">
        Data
        <input type="date" required value={data} onChange={(e) => setData(e.target.value)} className={CAMPO} />
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Tipo
        <select value={tipo} onChange={(e) => setTipo(e.target.value as Tipo)} className={CAMPO}>
          <option value="DESPESA">Despesa</option>
          <option value="RECEITA">Receita</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted">
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value as Status)} className={CAMPO}>
          <option value="PREVISTO">Previsto</option>
          <option value="PAGO">Pago</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs text-muted">
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
      <label className="grid gap-1 text-xs text-muted sm:col-span-1 lg:col-span-1">
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
      <label className="grid gap-1 text-xs text-muted">
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
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
        >
          {salvando ? "Salvando…" : editando ? "Salvar alterações" : "Adicionar lançamento"}
        </button>
        {editando && onCancelar && (
          <button
            type="button"
            onClick={onCancelar}
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-hover"
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
