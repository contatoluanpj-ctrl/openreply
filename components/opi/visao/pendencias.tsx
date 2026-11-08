import Link from "next/link";
import type { Pendencia } from "@/lib/opi/visao-geral";

export function ListaPendencias({ itens }: { itens: Pendencia[] }) {
  if (itens.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted">
        <span className="h-2 w-2 rounded-full bg-success" aria-hidden />
        Nada pendente. Tudo em dia.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border">
      {itens.map((p, i) => (
        <li key={`${p.href}-${i}`}>
          <Link
            href={p.href}
            className="flex items-center justify-between gap-3 py-2.5 text-sm text-foreground hover:text-muted"
          >
            <span className="flex min-w-0 items-center gap-2">
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${p.nivel === "erro" ? "bg-error" : "bg-muted"}`}
                aria-hidden
              />
              <span className="truncate">{p.texto}</span>
            </span>
            <span className="shrink-0 text-xs text-muted" aria-hidden>
              Abrir →
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
