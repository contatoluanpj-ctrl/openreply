"use client";

/**
 * Tela de erro do painel. Fica dentro do layout do dashboard, então o menu lateral continua na tela.
 * Não mostra mensagem nem pilha do erro: só o que o Luan pode fazer.
 */
import Link from "next/link";
import { useEffect } from "react";

export default function ErroDoPainel({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    // O detalhe técnico vai só para o console do servidor/navegador, não para a tela.
    console.error("Tela do painel não carregou", error.digest ?? "");
  }, [error]);

  return (
    <div role="alert" className="mx-auto mt-10 max-w-lg rounded-2xl border border-border bg-surface p-6 sm:p-8">
      <h1 className="font-display text-xl font-extrabold tracking-tight text-foreground">Esta tela não carregou</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Algo falhou ao montar esta página. Seus dados não foram alterados. Tente de novo; se continuar, volte para Hoje.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
        >
          Tentar de novo
        </button>
        <Link
          href="/dashboard"
          className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-semibold text-muted transition-colors hover:bg-surface-hover hover:text-foreground"
        >
          Voltar para Hoje
        </Link>
      </div>
    </div>
  );
}
