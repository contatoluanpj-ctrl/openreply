"use client";

import { confirmar } from "@/lib/opi/confirmar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/opi";
import { temAviso } from "@/lib/opi/aviso";
import { deslocarMes, diaSP, horaSP, mesAtual, POST_STATUS } from "@/lib/opi/posts-schema";
import { ChavePublicador } from "./chave-publicador";
import { ChipPost, IconeTipo, STATUS_CLASSE, STATUS_ROTULO, TIPO_ROTULO } from "./chip-post";
import { PainelDestinos, SelosDestinos } from "./destinos-post";
import { EditorPost } from "./editor-post";
import type { PostCalendario } from "./tipos";

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIAS_SEMANA_CURTO = ["D", "S", "T", "Q", "Q", "S", "S"];
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];
/** Até quantos chips cabem numa célula antes de virar "+N mais". */
const CHIPS_POR_DIA = 3;

type Pendencia = { id: string; motivo: string };
type Edicao = { post: PostCalendario | null; dia?: string } | null;
type Visao = "mes" | "lista";

const fmtDiaLista = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "UTC",
  weekday: "short",
  day: "2-digit",
  month: "short",
});

/** "sáb., 14 de nov." a partir de "AAAA-MM-DD" (a data já é o dia de São Paulo). */
function rotuloDia(dia: string) {
  const t = fmtDiaLista.format(new Date(`${dia}T12:00:00Z`));
  return `${t.charAt(0).toUpperCase()}${t.slice(1)}`;
}

function nomeMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  const nome = MESES[m - 1];
  return `${nome.charAt(0).toUpperCase()}${nome.slice(1)} de ${a}`;
}

const botaoNav =
  "rounded-full border border-border bg-white/40 px-2.5 py-1 text-sm text-foreground hover:bg-surface-hover";

export function CalendarioMes() {
  const [mes, setMes] = useState(() => mesAtual());
  const [posts, setPosts] = useState<PostCalendario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [edicao, setEdicao] = useState<Edicao>(null);
  const [aprovando, setAprovando] = useState(false);
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [visao, setVisao] = useState<Visao>("mes");
  const editorRef = useRef<HTMLDivElement>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/opi/posts?mes=${mes}`, { cache: "no-store" });
      const dados = (await res.json().catch(() => ({}))) as { posts?: PostCalendario[]; error?: string };
      if (!res.ok) throw new Error(dados.error ?? "Não foi possível carregar o calendário");
      setPosts(dados.posts ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o calendário");
      setPosts([]);
    } finally {
      setCarregando(false);
    }
  }, [mes]);

  useEffect(() => {
    void carregar();
    setPendencias([]);
    setMensagem(null);
  }, [carregar]);

  // Abriu um post (ou rascunho novo): leva o editor para a vista, principalmente no celular.
  useEffect(() => {
    if (edicao) editorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [edicao]);

  const porDia = useMemo(() => {
    const mapa = new Map<string, PostCalendario[]>();
    const ordenados = [...posts].sort((x, y) => x.agendadoPara.localeCompare(y.agendadoPara));
    for (const p of ordenados) {
      const d = diaSP(p.agendadoPara);
      mapa.set(d, [...(mapa.get(d) ?? []), p]);
    }
    return mapa;
  }, [posts]);

  const celulas = useMemo(() => {
    const [a, m] = mes.split("-").map(Number);
    const primeiroDiaSemana = new Date(Date.UTC(a, m - 1, 1)).getUTCDay();
    const diasNoMes = new Date(Date.UTC(a, m, 0)).getUTCDate();
    const lista: (string | null)[] = Array.from({ length: primeiroDiaSemana }, () => null);
    for (let d = 1; d <= diasNoMes; d++) lista.push(`${mes}-${String(d).padStart(2, "0")}`);
    while (lista.length % 7 !== 0) lista.push(null);
    return lista;
  }, [mes]);

  const rascunhos = posts.filter((p) => p.status === "RASCUNHO");
  const semAviso = rascunhos.filter((p) => !temAviso(p.legenda)).length;
  const hoje = diaSP(new Date());
  const pendenciaPorId = new Map(pendencias.map((p) => [p.id, p.motivo]));
  const diasComPost = [...porDia.keys()].sort();

  async function aprovarMes() {
    if (
      !await confirmar(
        `Aprovar ${rascunhos.length} rascunho(s) de ${nomeMes(mes)}? Eles serão publicados sozinhos na data e hora marcadas, se a publicação automática estiver ligada.`,
      )
    )
      return;
    setAprovando(true);
    setPendencias([]);
    setMensagem(null);
    setErro(null);
    try {
      const res = await fetch("/api/opi/posts/aprovar-mes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mes }),
      });
      const dados = (await res.json().catch(() => ({}))) as {
        error?: string;
        aprovados?: number;
        pendencias?: Pendencia[];
      };
      if (res.status === 422) {
        setPendencias(dados.pendencias ?? []);
        setErro(dados.error ?? "Há itens a corrigir antes de aprovar");
        return;
      }
      if (!res.ok) throw new Error(dados.error ?? "Não foi possível aprovar");
      setMensagem(`${dados.aprovados ?? 0} post(s) aprovado(s).`);
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível aprovar");
    } finally {
      setAprovando(false);
    }
  }

  return (
    <div className="space-y-4">
      <ChavePublicador />

      <Card
        title={nomeMes(mes)}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="opi-seg" role="group" aria-label="Visão do calendário">
              <button type="button" aria-pressed={visao === "mes"} onClick={() => setVisao("mes")}>
                Mês
              </button>
              <button type="button" aria-pressed={visao === "lista"} onClick={() => setVisao("lista")}>
                Lista
              </button>
            </div>
            <button
              type="button"
              onClick={() => setMes((m) => deslocarMes(m, -1))}
              className={botaoNav}
              aria-label="Mês anterior"
            >
              ‹
            </button>
            <button type="button" onClick={() => setMes(mesAtual())} className={botaoNav}>
              Hoje
            </button>
            <button
              type="button"
              onClick={() => setMes((m) => deslocarMes(m, 1))}
              className={botaoNav}
              aria-label="Próximo mês"
            >
              ›
            </button>
            <button type="button" onClick={() => setEdicao({ post: null })} className={botaoNav}>
              Novo rascunho
            </button>
            <button
              type="button"
              disabled={aprovando || rascunhos.length === 0}
              onClick={aprovarMes}
              className="rounded-full bg-accent px-3 py-1 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-40"
            >
              {aprovando ? "Aprovando..." : "Aprovar calendário do mês"}
            </button>
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <span>{posts.length} post(s) no mês</span>
          <span aria-hidden>·</span>
          <span>{rascunhos.length} rascunho(s)</span>
          {semAviso > 0 && (
            <>
              <span aria-hidden>·</span>
              <span className="text-error">{semAviso} sem o aviso obrigatório</span>
            </>
          )}
          {carregando && (
            <>
              <span aria-hidden>·</span>
              <span>Carregando…</span>
            </>
          )}
        </div>

        {erro && <p className="mb-3 text-sm text-error">{erro}</p>}
        {mensagem && <p className="mb-3 text-sm text-accent">{mensagem}</p>}

        {visao === "mes" ? (
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-2xl border border-border bg-border">
            {DIAS_SEMANA.map((d, i) => (
              <div key={d} className="bg-[#eef1f4] px-1 py-1.5 text-center text-[11px] font-semibold text-muted">
                <span className="sm:hidden">{DIAS_SEMANA_CURTO[i]}</span>
                <span className="hidden sm:inline">{d}</span>
              </div>
            ))}
            {celulas.map((dia, i) => {
              const doDia = dia ? (porDia.get(dia) ?? []) : [];
              const extras = doDia.length - CHIPS_POR_DIA;
              return (
                <div
                  key={dia ?? `vazio-${i}`}
                  className={`group min-h-16 min-w-0 p-1 sm:min-h-24 sm:p-1.5 ${dia ? "bg-[#f4f6f8]" : "bg-[#e9edf1]"}`}
                >
                  {dia && (
                    <>
                      <div className="mb-1 flex items-center justify-between">
                        <span
                          className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] tabular-nums ${
                            dia === hoje ? "bg-foreground font-semibold text-background" : "text-muted"
                          }`}
                        >
                          {Number(dia.slice(8))}
                        </span>
                        <button
                          type="button"
                          onClick={() => setEdicao({ post: null, dia })}
                          className="hidden h-5 w-5 items-center justify-center rounded-full text-xs text-muted opacity-0 transition hover:bg-surface-hover hover:text-foreground focus:opacity-100 group-hover:opacity-100 sm:inline-flex"
                          aria-label={`Novo rascunho em ${rotuloDia(dia)}`}
                        >
                          +
                        </button>
                      </div>
                      <div className="flex flex-col gap-1">
                        {doDia.slice(0, CHIPS_POR_DIA).map((p) => (
                          <ChipPost
                            key={p.id}
                            post={p}
                            pendencia={pendenciaPorId.get(p.id)}
                            onAbrir={() => setEdicao({ post: p })}
                          />
                        ))}
                        {extras > 0 && (
                          <button
                            type="button"
                            onClick={() => setVisao("lista")}
                            className="truncate text-left text-[10px] font-semibold text-muted hover:text-foreground"
                          >
                            +{extras} mais
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        ) : (
          <ListaPosts
            dias={diasComPost}
            porDia={porDia}
            pendenciaPorId={pendenciaPorId}
            carregando={carregando}
            onAbrir={(p) => setEdicao({ post: p })}
          />
        )}

        <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted" aria-label="Legenda das cores">
          {POST_STATUS.map((s) => (
            <li key={s} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={`h-2 w-2 rounded-full ${STATUS_CLASSE[s].ponto}`} />
              {STATUS_ROTULO[s]}
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-full ring-1 ring-error" />
            Contorno vermelho: falta o aviso, há pendência ou um destino falhou
          </li>
        </ul>
      </Card>

      {edicao && (
        <div ref={editorRef} className="scroll-mt-4">
          <Card title={edicao.post ? "Editar post" : "Novo rascunho"}>
            {edicao.post && (edicao.post.destinos?.length ?? 0) > 0 && (
              <div className="mb-5">
                <PainelDestinos
                  key={edicao.post.id}
                  postId={edicao.post.id}
                  destinos={edicao.post.destinos ?? []}
                  onMudou={() => void carregar()}
                />
              </div>
            )}
            <EditorPost
              key={edicao.post?.id ?? `novo-${edicao.dia ?? ""}`}
              post={edicao.post}
              diaInicial={edicao.dia}
              onFechar={() => setEdicao(null)}
              onSalvo={() => {
                setEdicao(null);
                setPendencias([]);
                void carregar();
              }}
            />
          </Card>
        </div>
      )}
    </div>
  );
}

function ListaPosts({
  dias,
  porDia,
  pendenciaPorId,
  carregando,
  onAbrir,
}: {
  dias: string[];
  porDia: Map<string, PostCalendario[]>;
  pendenciaPorId: Map<string, string>;
  carregando: boolean;
  onAbrir: (p: PostCalendario) => void;
}) {
  if (dias.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
        {carregando ? "Carregando…" : "Nenhum post neste mês. Use “Novo rascunho” para começar."}
      </p>
    );
  }
  return (
    <ol className="space-y-3">
      {dias.map((dia) => (
        <li key={dia}>
          <p className="mb-1.5 text-xs font-semibold text-muted">{rotuloDia(dia)}</p>
          <ul className="space-y-1.5">
            {(porDia.get(dia) ?? []).map((p) => {
              const pend = pendenciaPorId.get(p.id);
              const semAvisoPost = !temAviso(p.legenda);
              const cor = STATUS_CLASSE[p.status];
              const primeiraLinha = p.legenda.split("\n")[0]?.trim();
              return (
                <li
                  key={p.id}
                  className={`overflow-hidden rounded-2xl border bg-white/45 ${
                    semAvisoPost || pend ? "border-error/50" : "border-border"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => onAbrir(p)}
                    className="flex w-full min-w-0 items-center gap-3 px-3 py-2 text-left hover:bg-surface-hover"
                  >
                    <span
                      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${cor.chip}`}
                    >
                      <IconeTipo tipo={p.tipo} className="h-3.5 w-3.5" />
                    </span>
                    <span className="w-11 shrink-0 text-sm font-semibold tabular-nums text-foreground">
                      {horaSP(p.agendadoPara)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">
                        {primeiraLinha || TIPO_ROTULO[p.tipo]}
                      </span>
                      <span className="block truncate text-[11px] text-muted">
                        {TIPO_ROTULO[p.tipo]}
                        {semAvisoPost && <span className="text-error"> · sem o aviso obrigatório</span>}
                        {pend && <span className="text-error"> · {pend}</span>}
                        {p.status === "ERRO" && p.erro && <span className="text-error"> · {p.erro}</span>}
                      </span>
                    </span>
                    <span
                      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cor.chip}`}
                    >
                      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${cor.ponto}`} />
                      <span className="hidden sm:inline">{STATUS_ROTULO[p.status]}</span>
                    </span>
                  </button>
                  {/* Selos fora do botão: ocupam a largura toda da linha e quebram sem rolar para o lado. */}
                  <SelosDestinos destinos={p.destinos ?? []} className="px-3 pb-2.5 pt-0.5" />
                </li>
              );
            })}
          </ul>
        </li>
      ))}
    </ol>
  );
}
