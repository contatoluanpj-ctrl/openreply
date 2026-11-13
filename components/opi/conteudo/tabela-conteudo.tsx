"use client";

// Tabela "Desempenho por Reel": busca os posts em /api/instagram/overview (mesma rota da tela Seguidores) e mostra
// o indicador principal da OPI, (salvamentos + compartilhamentos) por 1.000 visualizações, com o melhor e o pior.
import { useEffect, useMemo, useState } from "react";
import { Badge, Card, StatTile } from "@/components/opi";
import { numero } from "@/components/opi/dashboard/formato";
import {
  indiceGeral,
  inicioLegenda,
  linhasConteudo,
  melhorEPior,
  MIN_VIEWS_DESTAQUE,
  ordenarConteudo,
  type ColunaConteudo,
  type Direcao,
  type LinhaConteudo,
  type PostBruto,
} from "@/lib/opi/conteudo";

type Resposta = { posts: PostBruto[]; insightsAvailable: boolean; truncated: boolean; account: { username: string } };
type Estado = { status: "carregando" } | { status: "erro"; mensagem: string } | { status: "ok"; dados: Resposta };

const QUANTIDADES = [
  { valor: "25", rotulo: "Últimos 25" },
  { valor: "50", rotulo: "Últimos 50" },
  { valor: "100", rotulo: "Últimos 100" },
] as const;

const COLUNAS: { id: ColunaConteudo; rotulo: string }[] = [
  { id: "views", rotulo: "Visualizações" },
  { id: "reach", rotulo: "Alcance" },
  { id: "saved", rotulo: "Salvamentos" },
  { id: "shares", rotulo: "Compart." },
  { id: "comments", rotulo: "Comentários" },
  { id: "indice", rotulo: "Por 1.000 views" },
];

const fmtData = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit" });
const fmtIndice = new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const TRACO = "—";
const n = (v: number | null) => (v === null ? TRACO : numero(v));
const indice = (v: number | null) => (v === null ? TRACO : fmtIndice.format(v));

function Cabecalho({
  id,
  rotulo,
  ordem,
  aoOrdenar,
  alinhar = "right",
}: {
  id: ColunaConteudo;
  rotulo: string;
  ordem: { coluna: ColunaConteudo; direcao: Direcao };
  aoOrdenar: (c: ColunaConteudo) => void;
  alinhar?: "left" | "right";
}) {
  const ativa = ordem.coluna === id;
  return (
    <th
      scope="col"
      aria-sort={ativa ? (ordem.direcao === "asc" ? "ascending" : "descending") : "none"}
      className={`pb-2 pr-4 font-semibold ${alinhar === "left" ? "text-left" : "text-right"}`}
    >
      <button
        type="button"
        onClick={() => aoOrdenar(id)}
        className={`inline-flex items-center gap-1 uppercase tracking-[.08em] hover:text-foreground ${ativa ? "text-foreground" : ""}`}
      >
        {rotulo}
        <span aria-hidden className="text-[10px]">{ativa ? (ordem.direcao === "asc" ? "▲" : "▼") : ""}</span>
      </button>
    </th>
  );
}

export function TabelaConteudo() {
  const [estado, setEstado] = useState<Estado>({ status: "carregando" });
  const [quantidade, setQuantidade] = useState<string>("50");
  const [ordem, setOrdem] = useState<{ coluna: ColunaConteudo; direcao: Direcao }>({ coluna: "timestamp", direcao: "desc" });

  useEffect(() => {
    let ativo = true;
    fetch(`/api/instagram/overview?count=${quantidade}`, { cache: "no-store" })
      .then(async (res) => {
        const corpo = (await res.json().catch(() => null)) as { success?: boolean; data?: Resposta } | null;
        if (res.status === 401) throw new Error("Sessão expirada. Entre de novo.");
        if (res.status === 400) throw new Error("Nenhuma conta do Instagram conectada. Conecte em Configurações.");
        if (!res.ok || !corpo?.success || !corpo.data) throw new Error("Não foi possível carregar os posts do Instagram agora.");
        if (ativo) setEstado({ status: "ok", dados: corpo.data });
      })
      .catch((e: unknown) => {
        if (ativo) setEstado({ status: "erro", mensagem: e instanceof Error ? e.message : "Erro inesperado." });
      });
    return () => {
      ativo = false;
    };
  }, [quantidade]);

  const linhas = useMemo(() => (estado.status === "ok" ? linhasConteudo(estado.dados.posts) : []), [estado]);
  const destaque = useMemo(() => melhorEPior(linhas), [linhas]);
  const ordenadas = useMemo(() => ordenarConteudo(linhas, ordem.coluna, ordem.direcao), [linhas, ordem]);
  const geral = useMemo(() => indiceGeral(linhas), [linhas]);
  const melhor = linhas.find((l) => l.id === destaque.melhorId) ?? null;
  const pior = linhas.find((l) => l.id === destaque.piorId) ?? null;

  function aoOrdenar(coluna: ColunaConteudo) {
    setOrdem((o) => (o.coluna === coluna ? { coluna, direcao: o.direcao === "desc" ? "asc" : "desc" } : { coluna, direcao: "desc" }));
  }

  function trocarQuantidade(valor: string) {
    setEstado({ status: "carregando" });
    setQuantidade(valor);
  }

  const resumoPost = (l: LinhaConteudo | null) => (l ? `${fmtData.format(new Date(l.timestamp))} · ${inicioLegenda(l.caption, 40)}` : "Ainda sem posts comparáveis");

  return (
    <>
      <section aria-label="Indicador principal" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="Salvos + compart. por 1.000 views"
          value={estado.status === "ok" ? indice(geral) : TRACO}
          hint={estado.status === "ok" ? `média de ${numero(linhas.filter((l) => l.indice !== null).length)} posts com visualizações` : "Carregando"}
        />
        <StatTile label="Melhor" tone="success" value={indice(melhor?.indice ?? null)} hint={resumoPost(melhor)} />
        <StatTile label="Pior" tone="error" value={indice(pior?.indice ?? null)} hint={resumoPost(pior)} />
      </section>

      <Card
        title="Desempenho por Reel"
        className="mt-6"
        actions={
          <label className="flex items-center gap-2 text-xs text-muted">
            <span className="sr-only">Quantos posts</span>
            <select
              value={quantidade}
              onChange={(e) => trocarQuantidade(e.target.value)}
              className="rounded-xl border border-border bg-white/70 px-3 py-2 text-sm text-foreground"
            >
              {QUANTIDADES.map((q) => (
                <option key={q.valor} value={q.valor}>
                  {q.rotulo}
                </option>
              ))}
            </select>
          </label>
        }
      >
        {estado.status === "carregando" && (
          <div aria-busy="true" className="space-y-2">
            <span className="sr-only">Carregando os posts…</span>
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} aria-hidden className="h-11 animate-pulse rounded-2xl bg-[#111217]/[0.06]" />
            ))}
          </div>
        )}
        {estado.status === "erro" && <p className="text-sm text-error">{estado.mensagem}</p>}
        {estado.status === "ok" && linhas.length === 0 && <p className="text-sm text-muted">Nenhum post publicado nesta conta ainda.</p>}
        {estado.status === "ok" && linhas.length > 0 && (
          <>
            {!estado.dados.insightsAvailable && (
              <p role="status" className="mb-4 rounded-xl border border-error/40 bg-error/10 px-3 py-2.5 text-sm text-error">
                O Instagram não liberou as métricas de visualização, salvamento e compartilhamento para esta conta. Reconecte a conta em
                Configurações para dar a permissão de métricas.
              </p>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[820px] text-sm">
                <thead>
                  <tr className="text-xs text-muted">
                    <Cabecalho id="timestamp" rotulo="Data" ordem={ordem} aoOrdenar={aoOrdenar} alinhar="left" />
                    <th scope="col" className="pb-2 pr-4 text-left font-semibold uppercase tracking-[.08em]">Legenda</th>
                    {COLUNAS.map((c) => (
                      <Cabecalho key={c.id} id={c.id} rotulo={c.rotulo} ordem={ordem} aoOrdenar={aoOrdenar} />
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ordenadas.map((l) => (
                    <tr key={l.id} className="border-t border-border">
                      <td className="whitespace-nowrap py-3 pr-4 text-muted">{fmtData.format(new Date(l.timestamp))}</td>
                      <td className="max-w-[320px] py-3 pr-4">
                        <span className="line-clamp-2 text-foreground">{inicioLegenda(l.caption)}</span>
                        {l.permalink && (
                          <a href={l.permalink} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-accent hover:underline">
                            Abrir no Instagram →
                          </a>
                        )}
                      </td>
                      <td className="py-3 pr-4 text-right tabular-nums">{n(l.views)}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{n(l.reach)}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{n(l.saved)}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{n(l.shares)}</td>
                      <td className="py-3 pr-4 text-right tabular-nums">{numero(l.comments)}</td>
                      <td className="py-3 pr-4 text-right">
                        <span className="inline-flex items-center justify-end gap-2">
                          {l.id === destaque.melhorId && <Badge tone="success">Melhor</Badge>}
                          {l.id === destaque.piorId && <Badge tone="error">Pior</Badge>}
                          <span className="opi-num text-base">{indice(l.indice)}</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-4 text-xs leading-relaxed text-muted">
              Por 1.000 views = (salvamentos + compartilhamentos) ÷ visualizações × 1.000. Melhor e pior consideram só posts com pelo menos{" "}
              {numero(MIN_VIEWS_DESTAQUE)} visualizações. Post sem visualização medida (foto ou carrossel) fica sem índice.
              {estado.dados.truncated ? " A lista foi cortada no limite da consulta." : ""}
            </p>
          </>
        )}
      </Card>
    </>
  );
}
