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

/** Número de destaque com rótulo e dica opcional. */
export function StatTile({ label, value, hint, tone = "neutral" }: StatTileProps) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        {label}
      </p>
      <p className={`mt-2 text-2xl font-semibold tabular-nums ${VALUE_TONE[tone]}`}>
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}
