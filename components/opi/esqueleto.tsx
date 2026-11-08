// Esqueletos de carregamento do OPI Central (loading.tsx de cada seção). Aparecem na hora em que o Luan
// clica na sidebar, enquanto o servidor monta a página; sem JavaScript e no mesmo vidro do painel.

export type FormaEsqueleto = "painel" | "lista" | "grade" | "conversa" | "formulario";

function Bloco({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded-2xl bg-[#111217]/[0.06] ${className}`} />;
}

function Cabecalho() {
  return (
    <div className="mb-8 space-y-3">
      <Bloco className="h-9 w-56 rounded-full" />
      <Bloco className="h-4 w-full max-w-xl rounded-full" />
    </div>
  );
}

export function Esqueleto({ forma = "lista", rotulo = "Carregando" }: { forma?: FormaEsqueleto; rotulo?: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{rotulo}…</span>
      <Cabecalho />

      {forma === "painel" && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="opi-glass muted space-y-3 p-5">
                <Bloco className="h-3 w-20 rounded-full" />
                <Bloco className="h-7 w-24 rounded-full" />
              </div>
            ))}
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }, (_, i) => (
              <div key={i} className="opi-glass muted space-y-4 p-6">
                <Bloco className="h-4 w-40 rounded-full" />
                <Bloco className="h-52 w-full" />
              </div>
            ))}
          </div>
        </div>
      )}

      {forma === "lista" && (
        <div className="opi-glass muted space-y-3 p-6">
          {Array.from({ length: 6 }, (_, i) => (
            <Bloco key={i} className="h-12 w-full" />
          ))}
        </div>
      )}

      {forma === "grade" && (
        <div className="space-y-4">
          <Bloco className="h-14 w-full max-w-md" />
          <div className="opi-glass muted p-6">
            <Bloco className="mb-4 h-5 w-44 rounded-full" />
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: 35 }, (_, i) => (
                <Bloco key={i} className="h-16 rounded-xl sm:h-24" />
              ))}
            </div>
          </div>
        </div>
      )}

      {forma === "conversa" && (
        <div className="opi-glass muted grid h-[calc(100dvh-15rem)] min-h-[420px] grid-cols-1 gap-4 p-4 sm:grid-cols-[300px_1fr]">
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Bloco key={i} className="h-12 w-full" />
            ))}
          </div>
          <Bloco className="hidden h-full sm:block" />
        </div>
      )}

      {forma === "formulario" && (
        <div className="opi-glass muted max-w-2xl space-y-4 p-6">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="space-y-2">
              <Bloco className="h-3 w-28 rounded-full" />
              <Bloco className="h-10 w-full" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
