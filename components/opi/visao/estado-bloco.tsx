import type { ReactNode } from "react";
import type { Bloco } from "@/lib/opi/visao-geral";

/** Mostra o conteúdo do bloco, ou uma linha cinza explicando por que ele está vazio. */
export function EstadoBloco<T>({
  bloco,
  vazio,
  children,
}: {
  bloco: Bloco<T>;
  vazio?: (dados: T) => ReactNode | null;
  children: (dados: T) => ReactNode;
}) {
  if (!bloco.ok) {
    return (
      <p className="text-sm text-muted">
        {bloco.motivo === "sem_tabela"
          ? "Tabela ainda não criada no banco (migration do OPI Central pendente)."
          : "Não foi possível carregar agora. Tente recarregar a página."}
      </p>
    );
  }
  const msgVazio = vazio?.(bloco.dados);
  if (msgVazio) return <p className="text-sm text-muted">{msgVazio}</p>;
  return <>{children(bloco.dados)}</>;
}
