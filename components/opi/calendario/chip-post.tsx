"use client";

// Chip compacto de um post na grade do Calendário: ícone do tipo, hora HH:mm (São Paulo) e cor discreta
// do status. Uma linha só, nunca estoura a célula; no celular fica só o ícone (a hora aparece na Lista).
import { temAviso } from "@/lib/opi/aviso";
import { horaSP, type PostStatusOpi, type PostTipoOpi } from "@/lib/opi/posts-schema";
import type { PostCalendario } from "./tipos";

export const STATUS_ROTULO: Record<PostStatusOpi, string> = {
  RASCUNHO: "Rascunho",
  APROVADO: "Aprovado",
  PUBLICANDO: "Publicando",
  PUBLICADO: "Publicado",
  ERRO: "Erro",
};

export const TIPO_ROTULO: Record<PostTipoOpi, string> = { CARROSSEL: "Carrossel", REEL: "Reel", POST: "Imagem" };

/** Rascunho cinza, aprovado/publicando no detalhe, publicado verde, erro vermelho. Tudo em tom baixo. */
export const STATUS_CLASSE: Record<PostStatusOpi, { chip: string; ponto: string }> = {
  RASCUNHO: { chip: "border-[#111217]/10 bg-white/60 text-[#111217]/70", ponto: "bg-[#111217]/35" },
  APROVADO: { chip: "border-accent/35 bg-accent/10 text-accent", ponto: "bg-accent" },
  PUBLICANDO: { chip: "border-accent/35 bg-accent/10 text-accent", ponto: "bg-accent animate-pulse" },
  PUBLICADO: { chip: "border-[#2f8f5b]/35 bg-[#2f8f5b]/10 text-[#26774b]", ponto: "bg-[#2f8f5b]" },
  ERRO: { chip: "border-error/40 bg-error/10 text-error", ponto: "bg-error" },
};

export function IconeTipo({ tipo, className = "h-3 w-3" }: { tipo: PostTipoOpi; className?: string }) {
  const comum = {
    className: `${className} shrink-0`,
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (tipo === "REEL")
    return (
      <svg {...comum}>
        <rect x="2" y="2" width="12" height="12" rx="3" />
        <path d="M6.5 5.5v5l4-2.5z" fill="currentColor" stroke="none" />
      </svg>
    );
  if (tipo === "CARROSSEL")
    return (
      <svg {...comum}>
        <rect x="4.5" y="2" width="9.5" height="9.5" rx="2" />
        <path d="M2 5v7.5A1.5 1.5 0 0 0 3.5 14H11" />
      </svg>
    );
  return (
    <svg {...comum}>
      <rect x="2" y="2" width="12" height="12" rx="2.5" />
      <circle cx="6" cy="6" r="1.2" fill="currentColor" stroke="none" />
      <path d="m2.5 12 3.5-3.5 2.5 2.5 2-2 3 3" />
    </svg>
  );
}

export function descreverPost(p: PostCalendario, pendencia?: string): string {
  const partes = [`${TIPO_ROTULO[p.tipo]} às ${horaSP(p.agendadoPara)}`, STATUS_ROTULO[p.status]];
  if (!temAviso(p.legenda)) partes.push("sem o aviso obrigatório");
  if (pendencia) partes.push(pendencia);
  return partes.join(", ");
}

export function ChipPost({
  post,
  pendencia,
  onAbrir,
}: {
  post: PostCalendario;
  pendencia?: string;
  onAbrir: () => void;
}) {
  const semAviso = !temAviso(post.legenda);
  const alerta = semAviso || !!pendencia;
  const cor = STATUS_CLASSE[post.status];
  const descricao = descreverPost(post, pendencia);
  return (
    <button
      type="button"
      onClick={onAbrir}
      title={descricao}
      aria-label={`Abrir ${descricao}`}
      className={`flex h-5 w-full min-w-0 items-center justify-center gap-1 overflow-hidden rounded-full border px-1 text-[11px] font-semibold leading-none tabular-nums transition hover:brightness-95 sm:justify-start sm:px-1.5 ${cor.chip} ${alerta ? "ring-1 ring-error/70" : ""}`}
    >
      <IconeTipo tipo={post.tipo} />
      <span className="hidden truncate sm:inline">{horaSP(post.agendadoPara)}</span>
      {alerta ? (
        <span aria-hidden className="ml-auto hidden h-1.5 w-1.5 shrink-0 rounded-full bg-error sm:inline-block" />
      ) : (
        <span aria-hidden className={`ml-auto hidden h-1.5 w-1.5 shrink-0 rounded-full sm:inline-block ${cor.ponto}`} />
      )}
    </button>
  );
}
