import type { ReactNode } from "react";

/** neutral = cinza; success = verde discreto (ativo/ok/enviado); error = vermelho discreto (erro/pausado/bloqueado). */
export type BadgeTone = "neutral" | "success" | "error";

export interface BadgeProps {
  tone?: BadgeTone;
  className?: string;
  children: ReactNode;
}

const TONE_CLASS: Record<BadgeTone, string> = {
  neutral: "border-border bg-surface-hover text-muted",
  success: "border-success/30 bg-success/10 text-success",
  error: "border-error/30 bg-error/10 text-error",
};

export function Badge({ tone = "neutral", className = "", children }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]} ${className}`}
    >
      {children}
    </span>
  );
}
