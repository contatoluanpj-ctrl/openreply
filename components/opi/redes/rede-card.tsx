import { Badge, type BadgeTone } from "@/components/opi";
import { ESTADO_ROTULO, rotuloMetrica, type RedeEstado, type RedeView } from "@/lib/opi/redes";
import { RedeIcone } from "./rede-icone";

const TONE: Record<RedeEstado, BadgeTone> = { conectado: "success", sem_dados: "neutral", sem_conta: "neutral" };
const nf = new Intl.NumberFormat("pt-BR");
const df = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

function formatar(valor: number | string | null) {
  if (valor === null) return "—";
  return typeof valor === "number" ? nf.format(valor) : valor;
}

/** Card uniforme de uma rede: ícone, estado, até 4 métricas, funções. */
export function RedeCard({ rede }: { rede: RedeView }) {
  const metricas = Object.entries(rede.metricas).slice(0, 4);
  return (
    <article className="flex h-full flex-col rounded-lg border border-border bg-surface p-4 sm:p-5">
      <header className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border bg-surface-hover text-foreground">
          <RedeIcone rede={rede.id} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-foreground">{rede.nome}</h2>
          <p className="text-xs text-muted">{rede.tipo === "ads" ? "Anúncios · só leitura" : "Rede social"}</p>
        </div>
        <Badge tone={TONE[rede.estado]}>{ESTADO_ROTULO[rede.estado]}</Badge>
      </header>

      <dl className="mt-4 grid min-h-[7.5rem] grid-cols-2 gap-x-3 gap-y-3 content-start">
        {metricas.length > 0 ? (
          metricas.map(([chave, valor]) => (
            <div key={chave} className="min-w-0">
              <dt className="truncate text-xs text-muted">{rotuloMetrica(chave)}</dt>
              <dd className="truncate text-lg font-semibold tabular-nums text-foreground">{formatar(valor)}</dd>
            </div>
          ))
        ) : (
          <p className="col-span-2 text-sm text-muted">
            {rede.estado === "sem_conta" ? "Nenhuma conta vinculada." : "Nenhuma métrica recebida ainda."}
          </p>
        )}
      </dl>

      <ul className="mt-4 space-y-1 border-t border-border pt-3 text-xs text-muted">
        {rede.funcoes.map((f) => (
          <li key={f} className="flex gap-2">
            <span aria-hidden className="text-border-hover">•</span>
            {f}
          </li>
        ))}
      </ul>

      <p className="mt-auto pt-3 text-xs text-muted">
        {rede.coletadoEm ? `Coletado em ${df.format(new Date(rede.coletadoEm))}` : "Sem coleta"}
      </p>
    </article>
  );
}
