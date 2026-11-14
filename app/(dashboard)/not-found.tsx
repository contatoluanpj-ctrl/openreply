import Link from "next/link";

export default function NaoEncontrado() {
  return (
    <div className="mx-auto mt-10 max-w-lg rounded-2xl border border-border bg-surface p-6 sm:p-8">
      <h1 className="font-display text-xl font-extrabold tracking-tight text-foreground">Página não encontrada</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">Esse endereço não existe no painel ou foi movido.</p>
      <Link
        href="/dashboard"
        className="mt-6 inline-flex min-h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-accent-foreground transition-colors hover:bg-accent-hover"
      >
        Voltar para Hoje
      </Link>
    </div>
  );
}
