"use client";

import { useState } from "react";
import { Badge } from "@/components/opi";
import { AVISO_OBRIGATORIO, temAviso } from "@/lib/opi/aviso";
import { deInputSP, diaSP, LEGENDA_MAX, paraInputSP, type PostTipoOpi } from "@/lib/opi/posts-schema";
import type { PostCalendario } from "./tipos";

const TIPO_ROTULO: Record<PostTipoOpi, string> = {
  CARROSSEL: "Carrossel",
  REEL: "Reel",
  POST: "Imagem única",
};

const campo =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-border-hover focus:outline-none";

export interface EditorPostProps {
  /** Post existente, ou null para criar um rascunho novo. */
  post: PostCalendario | null;
  /** Dia sugerido ("AAAA-MM-DD") quando criando. */
  diaInicial?: string;
  onSalvo: () => void;
  onFechar: () => void;
}

export function EditorPost({ post, diaInicial, onSalvo, onFechar }: EditorPostProps) {
  const [tipo, setTipo] = useState<PostTipoOpi>(post?.tipo ?? "CARROSSEL");
  const [midiasTexto, setMidiasTexto] = useState(
    Array.isArray(post?.midias) ? (post.midias as string[]).join("\n") : "",
  );
  const [legenda, setLegenda] = useState(post?.legenda ?? "");
  const [quando, setQuando] = useState(
    post ? paraInputSP(post.agendadoPara) : `${diaInicial ?? diaSP(new Date())}T18:00`,
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const bloqueado = post?.status === "PUBLICANDO" || post?.status === "PUBLICADO";
  const avisoOk = temAviso(legenda);
  const eraAprovado = post?.status === "APROVADO";

  function inserirAviso() {
    setLegenda((l) => (temAviso(l) ? l : `${l.trimEnd()}${l.trim() ? "\n\n" : ""}${AVISO_OBRIGATORIO}`));
  }

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const midias = midiasTexto
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean);
      const corpo = { tipo, midias, legenda, agendadoPara: deInputSP(quando) };
      const res = await fetch(post ? `/api/opi/posts/${post.id}` : "/api/opi/posts", {
        method: post ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(corpo),
      });
      const dados = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(dados.error ?? "Não foi possível salvar");
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir() {
    if (!post || !window.confirm("Apagar este post do calendário?")) return;
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch(`/api/opi/posts/${post.id}`, { method: "DELETE" });
      const dados = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(dados.error ?? "Não foi possível apagar");
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível apagar");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="space-y-4">
      {bloqueado && (
        <p className="text-sm text-muted">
          Este post já está em publicação ou publicado e não pode mais ser alterado.
          {post?.permalink && (
            <>
              {" "}
              <a href={post.permalink} target="_blank" rel="noreferrer" className="text-foreground underline">
                Ver no Instagram
              </a>
            </>
          )}
        </p>
      )}
      {post?.status === "ERRO" && post.erro && <p className="text-sm text-error">Erro: {post.erro}</p>}
      {eraAprovado && (
        <p className="text-sm text-muted">
          Este post está aprovado. Salvar qualquer mudança volta ele para rascunho, e o mês precisa ser aprovado de novo.
        </p>
      )}

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted">Tipo</span>
        <select
          className={campo}
          value={tipo}
          disabled={bloqueado}
          onChange={(e) => setTipo(e.target.value as PostTipoOpi)}
        >
          {(Object.keys(TIPO_ROTULO) as PostTipoOpi[]).map((t) => (
            <option key={t} value={t}>
              {TIPO_ROTULO[t]}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted">
          {tipo === "CARROSSEL"
            ? "URLs públicas das imagens, uma por linha, na ordem (2 a 10)"
            : tipo === "REEL"
              ? "URL pública do vídeo (https)"
              : "URL pública da imagem (https)"}
        </span>
        <textarea
          className={`${campo} min-h-24 font-mono text-xs`}
          value={midiasTexto}
          disabled={bloqueado}
          onChange={(e) => setMidiasTexto(e.target.value)}
          placeholder="https://..."
        />
      </label>

      <label className="block space-y-1">
        <span className="flex items-center justify-between gap-2 text-xs font-medium text-muted">
          <span>Legenda</span>
          <span>
            {legenda.length}/{LEGENDA_MAX}
          </span>
        </span>
        <textarea
          className={`${campo} min-h-40`}
          value={legenda}
          maxLength={LEGENDA_MAX}
          disabled={bloqueado}
          onChange={(e) => setLegenda(e.target.value)}
        />
        <span className="flex flex-wrap items-center gap-2">
          {avisoOk ? (
            <Badge tone="success">Aviso obrigatório presente</Badge>
          ) : (
            <>
              <Badge tone="error">Falta o aviso obrigatório</Badge>
              {!bloqueado && (
                <button
                  type="button"
                  onClick={inserirAviso}
                  className="rounded-md border border-border px-2 py-0.5 text-xs text-foreground hover:bg-surface-hover"
                >
                  Inserir aviso
                </button>
              )}
            </>
          )}
        </span>
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted">Data e hora (horário de Brasília)</span>
        <input
          type="datetime-local"
          className={campo}
          value={quando}
          disabled={bloqueado}
          onChange={(e) => setQuando(e.target.value)}
        />
      </label>

      {erro && <p className="text-sm text-error">{erro}</p>}

      <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
        <div className="flex gap-2">
          {!bloqueado && (
            <button
              type="button"
              disabled={salvando || !quando}
              onClick={salvar}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:bg-accent-hover disabled:opacity-50"
            >
              {salvando ? "Salvando..." : post ? "Salvar rascunho" : "Criar rascunho"}
            </button>
          )}
          <button
            type="button"
            onClick={onFechar}
            className="rounded-md border border-border px-4 py-2 text-sm text-foreground hover:bg-surface-hover"
          >
            Fechar
          </button>
        </div>
        {post && !bloqueado && (
          <button
            type="button"
            disabled={salvando}
            onClick={excluir}
            className="rounded-md px-3 py-2 text-sm text-error hover:bg-error/10 disabled:opacity-50"
          >
            Apagar
          </button>
        )}
      </div>
    </div>
  );
}
