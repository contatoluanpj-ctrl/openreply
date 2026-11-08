"use client";

import { confirmar } from "@/lib/opi/confirmar";
import { useCallback, useEffect, useState } from "react";
import { Badge, Card, StatTile } from "@/components/opi";
import {
  formatarBRL,
  mesAtual,
  type BarraMes,
  type LancamentoJson,
  type Resumo,
  paraCentavos,
} from "@/lib/opi/financeiro";
import { FormLancamento } from "./form-lancamento";
import { GraficoMensal } from "./grafico-mensal";

const CAMPO =
  "rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-border-hover focus:outline-none";

type Resposta = { data: LancamentoJson[]; resumo: Resumo; porMes: BarraMes[] };

function dataBR(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

export function PainelFinanceiro() {
  const [mes, setMes] = useState(mesAtual());
  const [tipo, setTipo] = useState<"" | "RECEITA" | "DESPESA">("");
  const [dados, setDados] = useState<Resposta | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<LancamentoJson | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const qs = new URLSearchParams();
      if (mes) qs.set("mes", mes);
      if (tipo) qs.set("tipo", tipo);
      const res = await fetch(`/api/opi/financeiro?${qs.toString()}`, { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as (Resposta & { error?: string }) | null;
      if (!res.ok || !json) {
        setErro(json?.error ?? "Não foi possível carregar o financeiro.");
        return;
      }
      setDados(json);
    } catch {
      setErro("Falha de conexão ao carregar o financeiro.");
    } finally {
      setCarregando(false);
    }
  }, [mes, tipo]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function apagar(l: LancamentoJson) {
    if (!await confirmar(`Apagar "${l.descricao}" (${formatarBRL(paraCentavos(l.valor))})? Não dá para desfazer.`)) {
      return;
    }
    const res = await fetch(`/api/opi/financeiro/${l.id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      setErro(json?.error ?? "Não foi possível apagar.");
      return;
    }
    if (editando?.id === l.id) setEditando(null);
    void carregar();
  }

  const r = dados?.resumo;

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1 text-xs text-muted">
          Mês
          <input type="month" value={mes} onChange={(e) => setMes(e.target.value)} className={CAMPO} />
        </label>
        <label className="grid gap-1 text-xs text-muted">
          Tipo
          <select
            value={tipo}
            onChange={(e) => setTipo(e.target.value as "" | "RECEITA" | "DESPESA")}
            className={CAMPO}
          >
            <option value="">Todos</option>
            <option value="RECEITA">Receita</option>
            <option value="DESPESA">Despesa</option>
          </select>
        </label>
        {mes && (
          <button
            type="button"
            onClick={() => setMes("")}
            className="rounded-md border border-border px-3 py-2 text-sm text-foreground hover:bg-surface-hover"
          >
            Todos os meses
          </button>
        )}
      </div>

      {erro && (
        <p role="alert" className="rounded-md border border-error/30 bg-error/10 px-3 py-2 text-sm text-error">
          {erro}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label="Receita" value={r ? formatarBRL(r.receita) : "—"} />
        <StatTile label="Despesa" value={r ? formatarBRL(r.despesa) : "—"} />
        <StatTile
          label="Saldo"
          value={r ? formatarBRL(r.saldo) : "—"}
          tone={r && r.saldo < 0 ? "error" : "neutral"}
        />
        <StatTile
          label="Previsto x Pago"
          value={r ? `${formatarBRL(r.previsto)} · ${formatarBRL(r.pago)}` : "—"}
          hint="Saldo (receita − despesa) de cada status"
        />
      </div>

      <Card title="Receita e despesa por mês">
        <GraficoMensal dados={dados?.porMes ?? []} />
      </Card>

      <Card
        title={editando ? "Editar lançamento" : "Novo lançamento"}
        actions={editando ? <Badge>Editando</Badge> : undefined}
      >
        <FormLancamento
          key={editando?.id ?? "novo"}
          editando={editando}
          onSalvo={() => {
            setEditando(null);
            void carregar();
          }}
          onCancelar={() => setEditando(null)}
        />
      </Card>

      <Card title="Lançamentos" actions={carregando ? <span className="text-xs text-muted">Carregando…</span> : undefined}>
        {dados && dados.data.length === 0 ? (
          <p className="text-sm text-muted">Nenhum lançamento neste filtro.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="text-xs uppercase tracking-wide text-muted">
                <tr className="border-b border-border">
                  <th className="py-2 pr-3 font-medium">Data</th>
                  <th className="py-2 pr-3 font-medium">Tipo</th>
                  <th className="py-2 pr-3 font-medium">Categoria</th>
                  <th className="py-2 pr-3 font-medium">Descrição</th>
                  <th className="py-2 pr-3 text-right font-medium">Valor</th>
                  <th className="py-2 pr-3 font-medium">Status</th>
                  <th className="py-2 font-medium" aria-label="Ações" />
                </tr>
              </thead>
              <tbody>
                {(dados?.data ?? []).map((l) => (
                  <tr key={l.id} className="border-b border-border last:border-0">
                    <td className="py-2 pr-3 tabular-nums text-muted">{dataBR(l.data)}</td>
                    <td className="py-2 pr-3">{l.tipo === "RECEITA" ? "Receita" : "Despesa"}</td>
                    <td className="py-2 pr-3 text-muted">{l.categoria}</td>
                    <td className="py-2 pr-3">{l.descricao}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {l.tipo === "DESPESA" ? "− " : ""}
                      {formatarBRL(paraCentavos(l.valor))}
                    </td>
                    <td className="py-2 pr-3">
                      <Badge tone={l.status === "PAGO" ? "success" : "neutral"}>
                        {l.status === "PAGO" ? "Pago" : "Previsto"}
                      </Badge>
                    </td>
                    <td className="py-2 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setEditando(l)}
                        className="rounded px-2 py-1 text-xs text-foreground hover:bg-surface-hover"
                      >
                        Editar
                      </button>
                      <button
                        type="button"
                        onClick={() => void apagar(l)}
                        className="rounded px-2 py-1 text-xs text-muted hover:bg-surface-hover hover:text-error"
                      >
                        Apagar
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="text-xs text-muted">
        Valores de controle interno. Nenhum gasto em Ads é feito por aqui: Ads ficam só em leitura.
      </p>
    </div>
  );
}
