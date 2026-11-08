import type { ReactNode } from "react";

export interface CardProps {
  title?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Cartão de vidro do OPI Central (mesmo estilo do Painel OPI): cantos de 24px, brilho e linha clara no topo. */
export function Card({ title, actions, className = "", children }: CardProps) {
  return (
    <section className={`opi-glass p-5 sm:p-6 ${className}`}>
      {(title || actions) && (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {title && (
            <h2 className="font-display text-base font-bold text-foreground">{title}</h2>
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
