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

/** Card de uma rede no estilo do Painel OPI: ícone em caixa, número de destaque, estatísticas em caixas. */
export function RedeCard({ rede }: { rede: RedeView }) {
  const [destaque, ...resto] = Object.entries(rede.metricas).slice(0, 5);
  const apagado = rede.estado !== "conectado";
  return (
    <article className={`opi-glass flex h-full flex-col p-5 ${apagado ? "opacity-70" : ""}`}>
      <header className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl border border-border bg-white/70 text-foreground">
            <RedeIcone rede={rede.id} className={`h-6 w-6 ${apagado ? "opacity-60 grayscale" : ""}`} />
          </span>
          <div className="min-w-0">
            <h2 className="truncate font-display text-base font-bold text-foreground">{rede.nome}</h2>
            <p className="truncate text-xs text-muted">{rede.tipo === "ads" ? "Anúncios · só leitura" : "Rede social"}</p>
          </div>
        </div>
        <Badge tone={TONE[rede.estado]}>{ESTADO_ROTULO[rede.estado]}</Badge>
      </header>

      {destaque ? (
        <>
          <div className="mt-5">
            <p className="opi-label">{rotuloMetrica(destaque[0])}</p>
            <p className="opi-num mt-1.5 text-[44px] leading-none text-foreground">{formatar(destaque[1])}</p>
          </div>
          {resto.length > 0 && (
            <dl className="mt-5 grid grid-cols-2 gap-2">
              {resto.map(([chave, valor]) => (
                <div key={chave} className="opi-inset min-w-0 px-3 py-2.5">
                  <dt className="truncate text-xs text-muted">{rotuloMetrica(chave)}</dt>
                  <dd className="opi-num mt-1 truncate text-xl leading-none text-foreground">{formatar(valor)}</dd>
                </div>
              ))}
            </dl>
          )}
        </>
      ) : (
        <div className="mt-5">
          <p className="opi-label">Sem métricas</p>
          <p className="opi-num mt-1.5 text-[44px] leading-none text-[#111217]/20">—</p>
        </div>
      )}

      <div className="mt-auto pt-5">
        <div className="rounded-xl border border-dashed border-[#111217]/15 bg-white/40 px-3 py-2.5 text-xs leading-relaxed text-muted">
          {rede.funcoes.join(" · ")}
        </div>
        <p className="mt-3 flex justify-between text-xs text-muted">
          <span>{rede.coletadoEm ? "Coletado em" : "Sem coleta"}</span>
          {rede.coletadoEm && <span className="text-foreground">{df.format(new Date(rede.coletadoEm))}</span>}
        </p>
      </div>
    </article>
  );
}
