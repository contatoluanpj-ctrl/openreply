import type { ReactNode } from "react";
import type { BadgeTone } from "./badge";

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: BadgeTone;
}

const VALUE_TONE: Record<BadgeTone, string> = {
  neutral: "text-foreground",
  success: "text-success",
  error: "text-error",
};

/** Número de destaque no estilo dos blocos do Painel OPI. */
export function StatTile({ label, value, hint, tone = "neutral" }: StatTileProps) {
  return (
    <div className="opi-tile">
      <p className="opi-label">{label}</p>
      <p className={`opi-num mt-1.5 text-[28px] leading-tight ${VALUE_TONE[tone]}`}>{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
