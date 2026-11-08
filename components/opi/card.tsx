import type { ReactNode } from "react";

export interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Bloco plano do OPI Central: superfície cinza-escura, borda fina, sem sombra. */
export function Card({ title, actions, className = "", children }: CardProps) {
  return (
    <section
      className={`rounded-lg border border-border bg-surface p-4 sm:p-5 ${className}`}
    >
      {(title || actions) && (
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && (
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
