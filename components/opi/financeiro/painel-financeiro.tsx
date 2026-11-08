"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { confirmar } from "@/lib/opi/confirmar";
import { formatarBRL, mesAtual, paraCentavos, type LancamentoJson } from "@/lib/opi/financeiro";
import { variacao, type PainelFin } from "@/lib/opi/financeiro-dados";
import { FormLancamento } from "./form-lancamento";
import {
  CabecalhoGrafico,
  COR,
  DonutCategorias,
  GraficoReceitaDespesa,
  GraficoSaldo,
  Legenda,
  PrevistoPagoMes,
  rotuloMes,
} from "./graficos";

type TipoFiltro = "" | "RECEITA" | "DESPESA";

const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function nomeMes(mes: string) {
  const [a, m] = mes.split("-");
  return `${NOMES_MES[Number(m) - 1]} de ${a}`;
}

function somarMes(mes: string, n: number) {
  const [a, m] = mes.split("-").map(Number);
  const d = new Date(Date.UTC(a, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function dataBR(iso: string) {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

/* Ícones de linha dos rótulos (mesmo traço do artefato). */
const I = {
  entra: <path d="M12 19V5m-6 6 6-6 6 6" />,
  sai: <path d="M12 5v14m6-6-6 6-6-6" />,
  saldo: <path d="M3 7h18v12H3zM3 11h18M16 15h2" />,
  check: <path d="m5 12 4 4 10-10" />,
  fogo: <path d="M12 3c1 4 5 5 5 10a5 5 0 0 1-10 0c0-3 2-4 2-7 1 1 2 2 3 2 0-2 0-3 0-5Z" />,
};

function Ic({ d }: { d: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d}
    </svg>
  );
}

function Delta({ pct, inverter = false }: { pct: number | null; inverter?: boolean }) {
  if (pct === null) return null;
  // Para despesa, subir é ruim: o destaque laranja fica para o que é bom para o caixa.
  const bom = inverter ? pct <= 0 : pct >= 0;
  return (
    <span className={`opi-delta ${bom ? "up" : "down"}`} title="Comparado ao mês anterior">
      {pct >= 0 ? "↗ +" : "↘ −"}
      {Math.abs(pct)}%
    </span>
  );
}

function Kpi({ icone, rotulo, valor, nota, delta }: { icone: ReactNode; rotulo: string; valor: string; nota?: ReactNode; delta?: ReactNode }) {
  return (
    <div className="opi-tile min-w-0">
      <div className="opi-label">
        <Ic d={icone} />
        {rotulo}
      </div>
      <div className="mt-1.5 flex flex-wrap items-baseline gap-2">
        <b className="opi-num text-[26px] font-black leading-tight">{valor}</b>
        {delta}
      </div>
      {nota && <small className="mt-0.5 block text-xs text-muted">{nota}</small>}
    </div>
  );
}

function Seg<T extends string>({ rotulo, valor, opcoes, onChange }: { rotulo: string; valor: T; opcoes: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="opi-seg" role="group" aria-label={rotulo}>
      {opcoes.map(([v, nome]) => (
        <button key={v || "todos"} type="button" aria-pressed={valor === v} onClick={() => onChange(v)}>
          {nome}
        </button>
      ))}
    </div>
  );
}

const BOTAO_PILULA =
  "rounded-full border border-[rgba(17,18,23,.12)] bg-white/50 px-3 py-1 text-xs font-semibold text-foreground/75 transition-colors hover:bg-white/90 hover:text-foreground";

export function PainelFinanceiro() {
  const [mes, setMes] = useState(mesAtual());
  const [todosMeses, setTodosMeses] = useState(false);
  const [tipo, setTipo] = useState<TipoFiltro>("");
  const [periodo, setPeriodo] = useState<"6" | "12">("12");
  const [escopoCat, setEscopoCat] = useState<"mes" | "12m">("mes");
  const [lista, setLista] = useState<LancamentoJson[] | null>(null);
  const [painel, setPainel] = useState<PainelFin | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [editando, setEditando] = useState<LancamentoJson | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const qs = new URLSearchParams();
      if (!todosMeses) qs.set("mes", mes);
      if (tipo) qs.set("tipo", tipo);
      const [rl, rp] = await Promise.all([
        fetch(`/api/opi/financeiro?${qs.toString()}`, { cache: "no-store" }),
        fetch(`/api/opi/financeiro/painel?mes=${mes}`, { cache: "no-store" }),
      ]);
      const jl = (await rl.json().catch(() => null)) as { data?: LancamentoJson[]; error?: string } | null;
      const jp = (await rp.json().catch(() => null)) as { data?: PainelFin; error?: string } | null;
      if (!rl.ok || !jl?.data) {
        setErro(jl?.error ?? "Não foi possível carregar os lançamentos.");
      } else {
        setLista(jl.data);
      }
      if (!rp.ok || !jp?.data) {
        setErro((e) => e ?? jp?.error ?? "Não foi possível carregar os gráficos.");
      } else {
        setPainel(jp.data);
      }
    } catch {
      setErro("Falha de conexão ao carregar o financeiro.");
    } finally {
      setCarregando(false);
    }
  }, [mes, tipo, todosMeses]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function apagar(l: LancamentoJson) {
    const ok = await confirmar(
      `Apagar "${l.descricao}" (${formatarBRL(paraCentavos(l.valor))})? Não dá para desfazer.`,
      "Apagar"
    );
    if (!ok) return;
    const res = await fetch(`/api/opi/financeiro/${l.id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      setErro(json?.error ?? "Não foi possível apagar.");
      return;
    }
    if (editando?.id === l.id) setEditando(null);
    void carregar();
  }

  async function marcarPago(l: LancamentoJson) {
    const res = await fetch(`/api/opi/financeiro/${l.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "PAGO" }),
    });
    if (!res.ok) {
      const json = (await res.json().catch(() => null)) as { error?: string } | null;
      setErro(json?.error ?? "Não foi possível marcar como pago.");
      return;
    }
    void carregar();
  }

  function editar(l: LancamentoJson) {
    setEditando(l);
    requestAnimationFrame(() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  const k = painel?.kpis;
  const serie = painel ? painel.serie.slice(-Number(periodo)) : [];
  const acumulado = painel?.serie[painel.serie.length - 1]?.acumulado ?? 0;
  const folego = k?.burnMedio && acumulado > 0 ? Math.floor(acumulado / k.burnMedio) : null;
  const dm = painel?.despesasMes;

  return (
    <div className="grid gap-6">
      {/* Controles: mês de referência em pílula. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1 rounded-full border border-[rgba(17,18,23,.1)] bg-white/55 p-1 backdrop-blur">
          <button type="button" aria-label="Mês anterior" onClick={() => setMes((m) => somarMes(m, -1))} className="grid h-8 w-8 place-items-center rounded-full text-foreground/70 hover:bg-white">
            ‹
          </button>
          <label className="relative px-2 text-sm font-semibold text-foreground first-letter:uppercase">
            {nomeMes(mes)}
            <input
              type="month"
              value={mes}
              onChange={(e) => e.target.value && setMes(e.target.value)}
              aria-label="Escolher mês"
              className="absolute inset-0 cursor-pointer opacity-0"
            />
          </label>
          <button type="button" aria-label="Próximo mês" onClick={() => setMes((m) => somarMes(m, 1))} className="grid h-8 w-8 place-items-center rounded-full text-foreground/70 hover:bg-white">
            ›
          </button>
        </div>
        {mes !== mesAtual() && (
          <button type="button" onClick={() => setMes(mesAtual())} className={BOTAO_PILULA}>
            Voltar para o mês atual
          </button>
        )}
        {carregando && <span className="text-xs text-muted">Atualizando…</span>}
      </div>

      {erro && (
        <p role="alert" className="rounded-2xl border border-error/30 bg-error/10 px-4 py-2.5 text-sm text-error">
          {erro}
        </p>
      )}

      {/* KPIs do mês. */}
      <section aria-label="Resumo do mês" className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(min(100%,12.5rem),1fr))]">
        <Kpi
          icone={I.entra}
          rotulo="Receita do mês"
          valor={k ? formatarBRL(k.receita) : "—"}
          delta={k && <Delta pct={variacao(k.receita, k.receitaAnterior)} />}
          nota={rotuloMes(mes, true)}
        />
        <Kpi
          icone={I.sai}
          rotulo="Despesa do mês"
          valor={k ? formatarBRL(k.despesa) : "—"}
          delta={k && <Delta pct={variacao(k.despesa, k.despesaAnterior)} inverter />}
          nota="pagas + previstas"
        />
        <Kpi
          icone={I.saldo}
          rotulo="Saldo do mês"
          valor={k ? formatarBRL(k.saldo) : "—"}
          nota={painel ? `acumulado ${formatarBRL(acumulado)}` : undefined}
        />
        <Kpi
          icone={I.check}
          rotulo="Previsto x pago"
          valor={dm && dm.pctPago !== null ? `${dm.pctPago}% pago` : "—"}
          nota={dm && dm.total > 0 ? `${formatarBRL(dm.pago)} de ${formatarBRL(dm.total)} em despesas` : "sem despesas no mês"}
        />
        <Kpi
          icone={I.fogo}
          rotulo="Burn mensal médio"
          valor={k?.burnMedio != null ? formatarBRL(k.burnMedio) : "—"}
          nota={
            k?.burnMedio != null
              ? `média de ${k.burnMeses} ${k.burnMeses === 1 ? "mês" : "meses"}${folego !== null ? ` · fôlego ≈ ${folego} ${folego === 1 ? "mês" : "meses"}` : ""}`
              : "aparece com a primeira despesa"
          }
        />
      </section>

      {/* Gráficos para decidir. */}
      <section aria-label="Gráficos" className="grid gap-4 lg:grid-cols-3">
        <div className="opi-glass min-w-0 p-[22px] lg:col-span-2">
          <CabecalhoGrafico
            titulo="Receita x despesa por mês"
            olhar="Barra grafite maior que a laranja é mês no vermelho. Veja se o gasto cresce mais rápido que a receita."
            controle={
              <div className="flex flex-wrap items-center gap-3">
                <Legenda itens={[{ cor: COR.principal, nome: "Receita" }, { cor: COR.secundaria, nome: "Despesa" }]} />
                <Seg rotulo="Período" valor={periodo} onChange={setPeriodo} opcoes={[["6", "6m"], ["12", "12m"]]} />
              </div>
            }
          />
          {painel ? <GraficoReceitaDespesa serie={serie} /> : <div className="h-[260px]" />}
        </div>

        <div className="opi-glass min-w-0 p-[22px]">
          <CabecalhoGrafico
            titulo="Despesas por categoria"
            olhar="Onde está o gasto. A primeira fatia é a primeira a revisar."
            controle={<Seg rotulo="Escopo" valor={escopoCat} onChange={setEscopoCat} opcoes={[["mes", "Mês"], ["12m", "12m"]]} />}
          />
          {painel ? <DonutCategorias fatias={escopoCat === "mes" ? painel.categoriasMes : painel.categorias12m} /> : <div className="h-[200px]" />}
        </div>

        <div className="opi-glass min-w-0 p-[22px] lg:col-span-2">
          <CabecalhoGrafico
            titulo="Saldo acumulado"
            olhar="Linha caindo é caixa sendo queimado. O tracejado mostra o saldo de cada mês."
            controle={<Legenda itens={[{ cor: COR.principal, nome: "Acumulado" }, { cor: COR.terciaria, nome: "Saldo do mês" }]} />}
          />
          {painel ? <GraficoSaldo serie={serie} /> : <div className="h-[260px]" />}
        </div>

        <div className="opi-glass min-w-0 p-[22px]">
          <CabecalhoGrafico
            titulo="Previsto x pago do mês"
            olhar="O que ainda falta sair ou entrar. Muito previsto perto do fim do mês pede atenção."
          />
          {painel ? <PrevistoPagoMes despesas={painel.despesasMes} receitas={painel.receitasMes} /> : <div className="h-[160px]" />}
        </div>
      </section>

      {/* Novo / editar lançamento. */}
      <div ref={formRef} className="opi-glass scroll-mt-6 p-[22px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-display text-base font-bold text-foreground">{editando ? "Editar lançamento" : "Novo lançamento"}</h3>
          {editando && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent/45 bg-accent/10 px-2.5 py-1 text-xs font-bold text-accent">
              Editando
            </span>
          )}
        </div>
        <FormLancamento
          key={editando?.id ?? "novo"}
          editando={editando}
          onSalvo={() => {
            setEditando(null);
            void carregar();
          }}
          onCancelar={() => setEditando(null)}
        />
      </div>

      {/* Lançamentos. */}
      <div className="opi-glass min-w-0">
        <div className="flex flex-wrap items-center justify-between gap-3 px-[22px] pt-[22px]">
          <div>
            <h3 className="font-display text-base font-bold text-foreground">Lançamentos</h3>
            <p className="mt-[3px] text-xs text-muted">
              {todosMeses ? "Todos os meses" : nomeMes(mes)}
              {lista ? ` · ${lista.length} ${lista.length === 1 ? "lançamento" : "lançamentos"}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Seg rotulo="Tipo" valor={tipo} onChange={setTipo} opcoes={[["", "Todos"], ["RECEITA", "Receitas"], ["DESPESA", "Despesas"]]} />
            <Seg
              rotulo="Meses"
              valor={todosMeses ? "todos" : "mes"}
              onChange={(v) => setTodosMeses(v === "todos")}
              opcoes={[["mes", "Este mês"], ["todos", "Todos"]]}
            />
          </div>
        </div>

        {lista && lista.length === 0 ? (
          <p className="px-[22px] py-10 text-center text-sm text-muted">Nenhum lançamento neste filtro. Use o formulário acima para lançar.</p>
        ) : (
          <div className="mt-4 max-h-[560px] overflow-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-[13px]">
              <thead>
                <tr>
                  {["Data", "Descrição", "Categoria", "Tipo", "Valor", "Status", ""].map((h, i) => (
                    <th
                      key={h || "acoes"}
                      className={`sticky top-0 z-[1] whitespace-nowrap bg-[#eef1f4]/95 px-3.5 py-3 font-semibold backdrop-blur ${i === 4 ? "text-right" : ""}`}
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(lista ?? []).map((l) => (
                  <tr key={l.id} className="border-t border-[rgba(17,18,23,.07)] hover:bg-white/40">
                    <td className="whitespace-nowrap px-3.5 py-[11px] tabular-nums text-muted">{dataBR(l.data)}</td>
                    <td className="px-3.5 py-[11px] text-foreground">{l.descricao}</td>
                    <td className="px-3.5 py-[11px] text-muted">{l.categoria}</td>
                    <td className="px-3.5 py-[11px]">
                      <span className="inline-flex items-center gap-1.5 text-foreground/75">
                        <i className="inline-block h-2 w-2 rounded-full" style={{ background: l.tipo === "RECEITA" ? COR.principal : COR.secundaria }} />
                        {l.tipo === "RECEITA" ? "Receita" : "Despesa"}
                      </span>
                    </td>
                    <td className={`whitespace-nowrap px-3.5 py-[11px] text-right font-semibold tabular-nums ${l.tipo === "RECEITA" ? "text-accent" : "text-foreground"}`}>
                      {l.tipo === "DESPESA" ? "− " : "+ "}
                      {formatarBRL(paraCentavos(l.valor))}
                    </td>
                    <td className="px-3.5 py-[11px]">
                      {l.status === "PAGO" ? (
                        <span className="inline-block whitespace-nowrap rounded-full border border-accent/45 bg-accent/10 px-[9px] py-[3px] text-[11px] font-bold text-accent">
                          {l.tipo === "RECEITA" ? "Recebido" : "Pago"}
                        </span>
                      ) : (
                        <span className="inline-block whitespace-nowrap rounded-full border border-[rgba(17,18,23,.16)] px-[9px] py-[3px] text-[11px] font-bold text-foreground/60">
                          Previsto
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3.5 py-[11px] text-right">
                      <div className="inline-flex gap-1.5">
                        {l.status === "PREVISTO" && (
                          <button type="button" onClick={() => void marcarPago(l)} className={BOTAO_PILULA}>
                            {l.tipo === "RECEITA" ? "Marcar recebido" : "Marcar pago"}
                          </button>
                        )}
                        <button type="button" onClick={() => editar(l)} className={BOTAO_PILULA}>
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => void apagar(l)}
                          className="rounded-full border border-[rgba(17,18,23,.12)] bg-white/50 px-3 py-1 text-xs font-semibold text-foreground/60 transition-colors hover:border-error/40 hover:bg-error/10 hover:text-error"
                        >
                          Apagar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <p className="text-xs text-muted">
        Valores de controle interno. Nenhum gasto em Ads é feito por aqui: Ads ficam só em leitura. Todo gasto novo precisa do seu OK.
      </p>
    </div>
  );
}
