"use client";

import { confirmar } from "@/lib/opi/confirmar";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Card, type BadgeTone } from "@/components/opi";
import { temAviso } from "@/lib/opi/aviso";
import {
  deslocarMes,
  diaSP,
  horaSP,
  mesAtual,
  type PostStatusOpi,
  type PostTipoOpi,
} from "@/lib/opi/posts-schema";
import { EditorPost } from "./editor-post";
import type { PostCalendario } from "./tipos";

const DIAS_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const MESES = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

const STATUS_ROTULO: Record<PostStatusOpi, string> = {
  RASCUNHO: "Rascunho",
  APROVADO: "Aprovado",
  PUBLICANDO: "Publicando",
  PUBLICADO: "Publicado",
  ERRO: "Erro",
};
const STATUS_TOM: Record<PostStatusOpi, BadgeTone> = {
  RASCUNHO: "neutral",
  APROVADO: "success",
  PUBLICANDO: "neutral",
  PUBLICADO: "success",
  ERRO: "error",
};
const TIPO_CURTO: Record<PostTipoOpi, string> = { CARROSSEL: "Carrossel", REEL: "Reel", POST: "Imagem" };

type Pendencia = { id: string; motivo: string };
type Edicao = { post: PostCalendario | null; dia?: string } | null;

function nomeMes(mes: string) {
  const [a, m] = mes.split("-").map(Number);
  return `${MESES[m - 1]} de ${a}`;
}

export function CalendarioMes() {
  const [mes, setMes] = useState(() => mesAtual());
  const [posts, setPosts] = useState<PostCalendario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [edicao, setEdicao] = useState<Edicao>(null);
  const [aprovando, setAprovando] = useState(false);
  const [pendencias, setPendencias] = useState<Pendencia[]>([]);
  const [mensagem, setMensagem] = useState<string | null>(null);

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

  const porDia = useMemo(() => {
    const mapa = new Map<string, PostCalendario[]>();
    for (const p of posts) {
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

  async function aprovarMes() {
    if (
      !await confirmar(
        `Aprovar ${rascunhos.length} rascunho(s) de ${nomeMes(mes)}? Eles serão publicados sozinhos na data e hora marcadas.`,
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
      <Card
        title={<span className="capitalize">{nomeMes(mes)}</span>}
        actions={
          <>
            <button
              type="button"
              onClick={() => setMes((m) => deslocarMes(m, -1))}
              className="rounded-md border border-border px-2.5 py-1 text-sm text-foreground hover:bg-surface-hover"
              aria-label="Mês anterior"
            >
              ‹
            </button>
            <button
              type="button"
              onClick={() => setMes(mesAtual())}
              className="rounded-md border border-border px-2.5 py-1 text-sm text-foreground hover:bg-surface-hover"
            >
              Hoje
            </button>
            <button
              type="button"
              onClick={() => setMes((m) => deslocarMes(m, 1))}
              className="rounded-md border border-border px-2.5 py-1 text-sm text-foreground hover:bg-surface-hover"
              aria-label="Próximo mês"
            >
              ›
            </button>
            <button
              type="button"
              onClick={() => setEdicao({ post: null })}
              className="rounded-md border border-border px-3 py-1 text-sm text-foreground hover:bg-surface-hover"
            >
              Novo rascunho
            </button>
            <button
              type="button"
              disabled={aprovando || rascunhos.length === 0}
              onClick={aprovarMes}
              className="rounded-md bg-accent px-3 py-1 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-40"
            >
              {aprovando ? "Aprovando..." : "Aprovar calendário do mês"}
            </button>
          </>
        }
      >
        <div className="mb-3 flex flex-wrap gap-2 text-xs text-muted">
          <span>{posts.length} post(s) no mês</span>
          <span>·</span>
          <span>{rascunhos.length} rascunho(s)</span>
          {semAviso > 0 && (
            <>
              <span>·</span>
              <span className="text-error">{semAviso} sem o aviso obrigatório</span>
            </>
          )}
        </div>

        {erro && <p className="mb-3 text-sm text-error">{erro}</p>}
        {mensagem && <p className="mb-3 text-sm text-success">{mensagem}</p>}

        <div className="overflow-x-auto">
          <div className="grid min-w-[640px] grid-cols-7 gap-px overflow-hidden rounded-md border border-border bg-border">
            {DIAS_SEMANA.map((d) => (
              <div key={d} className="bg-surface px-2 py-1.5 text-center text-xs font-medium text-muted">
                {d}
              </div>
            ))}
            {celulas.map((dia, i) => (
              <div
                key={dia ?? `vazio-${i}`}
                className={`min-h-24 bg-background p-1.5 ${dia ? "" : "opacity-40"}`}
              >
                {dia && (
                  <>
                    <div className="mb-1 flex items-center justify-between">
                      <span
                        className={`text-xs ${dia === hoje ? "rounded bg-foreground px-1 font-semibold text-background" : "text-muted"}`}
                      >
                        {Number(dia.slice(8))}
                      </span>
                      <button
                        type="button"
                        onClick={() => setEdicao({ post: null, dia })}
                        className="rounded px-1 text-xs text-muted hover:bg-surface-hover hover:text-foreground"
                        aria-label={`Novo rascunho em ${dia}`}
                      >
                        +
                      </button>
                    </div>
                    <div className="space-y-1">
                      {(porDia.get(dia) ?? []).map((p) => {
                        const pend = pendenciaPorId.get(p.id);
                        return (
                          <button
                            key={p.id}
                            type="button"
                            onClick={() => setEdicao({ post: p })}
                            className={`block w-full rounded border px-1.5 py-1 text-left text-xs hover:bg-surface-hover ${pend ? "border-error/60" : "border-border"} bg-surface`}
                            title={pend ?? p.legenda.slice(0, 120)}
                          >
                            <span className="flex items-center justify-between gap-1">
                              <span className="font-medium text-foreground">{horaSP(p.agendadoPara)}</span>
                              <span className="text-muted">{TIPO_CURTO[p.tipo]}</span>
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-1">
                              <Badge tone={STATUS_TOM[p.status]} className="px-1.5 py-0 text-[10px]">
                                {STATUS_ROTULO[p.status]}
                              </Badge>
                              {!temAviso(p.legenda) && (
                                <Badge tone="error" className="px-1.5 py-0 text-[10px]">
                                  Sem aviso
                                </Badge>
                              )}
                            </span>
                            {pend && <span className="mt-0.5 block text-[10px] text-error">{pend}</span>}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
        {carregando && <p className="mt-3 text-xs text-muted">Carregando...</p>}
      </Card>

      {edicao && (
        <Card title={edicao.post ? "Editar post" : "Novo rascunho"}>
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
      )}
    </div>
  );
}
