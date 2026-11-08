import type { ReactNode } from "react";

/** neutral = cinza; success = verde discreto (ativo/ok/enviado); error = vermelho discreto (erro/pausado/bloqueado). */
export type BadgeTone = "neutral" | "success" | "error";

export interface BadgeProps {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "border-white/10 bg-white/[0.04] text-muted",
  success: "border-success/40 bg-success/10 text-success",
  error: "border-error/40 bg-error/10 text-error",
};

const DOT: Record<BadgeTone, string> = {
  neutral: "",
  success: "bg-success",
  error: "bg-error",
};

/** Pílula de estado; ativo/erro levam um ponto, como o "ao vivo" do artefato. */
export function Badge({ tone = "neutral", className = "", children }: BadgeProps) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold ${TONE_CLASS[tone]} ${className}`}
    >
      {tone !== "neutral" && <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />}
      {children}
    </span>
  );
}
