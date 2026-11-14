"use client";

// Destinos de um post (uma rede cada) no Calendário: selo por rede com o status escrito (cor + texto),
// link da publicação, erro legível, "Tentar de novo" para o que falhou e "Aprovar" para LinkedIn e X.
// Só cores do tema (variáveis de app/globals.css), para acompanhar a troca de tema. Texto pequeno usa a cor
// da tela (text-foreground, inteira ou a 80%): text-muted mediu 4,3:1 sobre o cartão, abaixo de 4,5:1.
import { useState } from "react";
import { confirmar } from "@/lib/opi/confirmar";
import { isRedeDestino, type DestinoStatusOpi, type DestinoView } from "@/lib/opi/destinos";
import { horaSP } from "@/lib/opi/posts-schema";
import { RedeIcone } from "@/components/opi/redes/rede-icone";
import { erroLegivel, podeTentarDeNovo, precisaAprovar, rotuloDestino } from "./destinos-texto";

/**
 * Fundo, contorno e marca por status. O texto do selo é sempre o da tela (contraste alto); a cor só reforça.
 * Publicado leva um visto em vez do ponto: no tema atual --color-success é o mesmo laranja do destaque,
 * então o visto é o que separa "Publicado" de "Publicando" e de "Erro" sem depender de cor.
 */
const SELO_CLASSE: Record<DestinoStatusOpi, { selo: string; ponto: string }> = {
  PENDENTE: { selo: "border-border-hover bg-surface", ponto: "bg-muted" },
  PUBLICANDO: { selo: "border-accent/50 bg-accent/10", ponto: "bg-accent animate-pulse" },
  PUBLICADO: { selo: "border-foreground/25 bg-surface", ponto: "" },
  ERRO: { selo: "border-error/60 bg-error/10", ponto: "bg-error" },
  PULADO: { selo: "border-dashed border-border-hover bg-transparent", ponto: "bg-muted" },
};

function Visto() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 12 12"
      className="h-3 w-3 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="m2.5 6.5 2.5 2.5 4.5-5.5" />
    </svg>
  );
}

function IconeDaRede({ rede, className }: { rede: string; className: string }) {
  if (!isRedeDestino(rede)) return null;
  return <RedeIcone rede={rede} className={`${className} shrink-0`} />;
}

/**
 * Selo pequeno de um destino: ícone da rede + status escrito. O nome da rede vai para leitor de tela e title.
 * `semRede` tira o ícone quando a rede já está escrita ao lado (painel do detalhe).
 */
export function SeloDestino({ destino, semRede = false }: { destino: DestinoView; semRede?: boolean }) {
  const classe = SELO_CLASSE[destino.status] ?? SELO_CLASSE.PENDENTE;
  const rotulo = rotuloDestino(destino);
  return (
    <span
      title={`${destino.nome}: ${rotulo}`}
      className={`inline-flex max-w-full items-center gap-1 rounded-full border px-1.5 py-0.5 text-[11px] font-semibold leading-tight text-foreground ${classe.selo}`}
    >
      {!semRede && (
        <>
          <IconeDaRede rede={destino.rede} className="h-3 w-3" />
          <span className="sr-only">{destino.nome}:</span>
        </>
      )}
      {destino.status === "PUBLICADO" ? (
        <Visto />
      ) : (
        <span aria-hidden className={`h-1.5 w-1.5 shrink-0 rounded-full ${classe.ponto}`} />
      )}
      <span className="truncate">{rotulo}</span>
    </span>
  );
}

/** Linha de selos (quebra de linha quando não cabe; nunca rola para o lado). */
export function SelosDestinos({ destinos, className = "" }: { destinos: DestinoView[]; className?: string }) {
  if (destinos.length === 0) return null;
  return (
    <span className={`flex min-w-0 flex-wrap gap-1 ${className}`}>
      {destinos.map((d) => (
        <SeloDestino key={d.id} destino={d} />
      ))}
    </span>
  );
}

const fmtDiaMes = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

function quando(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${fmtDiaMes.format(d)} às ${horaSP(iso)}`;
}

function linkSeguro(url: string | null): string | null {
  return url && /^https?:\/\//i.test(url) ? url : null;
}

const botaoAcao =
  "inline-flex min-h-9 items-center rounded-full border px-3.5 py-1.5 text-sm font-medium disabled:opacity-50";

/**
 * Painel dos destinos no detalhe do post. Cada ação chama POST /api/opi/posts/[id]/destinos e troca só
 * o destino devolvido; `onMudou` avisa o Calendário para recarregar a grade. Use `key` com o id ao trocar de post.
 */
export function PainelDestinos({
  postId,
  destinos: iniciais,
  onMudou,
}: {
  postId: string;
  destinos: DestinoView[];
  onMudou?: () => void;
}) {
  const [destinos, setDestinos] = useState(iniciais);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  async function enviar(destino: DestinoView, corpo: { aprovar?: true; tentarDeNovo?: true }, feito: string) {
    setOcupado(`${destino.rede}:${corpo.aprovar ? "aprovar" : "repetir"}`);
    setErro(null);
    setAviso(null);
    try {
      const res = await fetch(`/api/opi/posts/${postId}/destinos`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rede: destino.rede, ...corpo }),
      });
      const dados = (await res.json().catch(() => ({}))) as { destino?: DestinoView | null; error?: string };
      if (!res.ok) throw new Error(dados.error ?? "Não foi possível atualizar o destino");
      const novo = dados.destino;
      if (novo) setDestinos((lista) => lista.map((d) => (d.rede === novo.rede ? novo : d)));
      setAviso(feito);
      onMudou?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível atualizar o destino");
    } finally {
      setOcupado(null);
    }
  }

  async function aprovar(destino: DestinoView) {
    const ok = await confirmar(
      `Aprovar a publicação deste post no ${destino.nome}? Depois de aprovado, ele pode sair sozinho na data e hora marcadas.`,
      "Aprovar",
    );
    if (ok) await enviar(destino, { aprovar: true }, `Destino ${destino.nome} aprovado.`);
  }

  return (
    <section aria-labelledby={`destinos-${postId}`} className="space-y-2">
      <h3 id={`destinos-${postId}`} className="text-sm font-semibold text-foreground">
        Destinos
      </h3>

      {destinos.length === 0 ? (
        <p className="text-sm text-foreground/80">Este post ainda não tem destinos.</p>
      ) : (
        <ul className="space-y-2">
          {destinos.map((d) => {
            const link = d.status === "PUBLICADO" ? linkSeguro(d.permalink) : null;
            const publicadoEm = d.status === "PUBLICADO" && d.publicadoEm ? quando(d.publicadoEm) : "";
            const aprovavel = precisaAprovar(d);
            const repetivel = podeTentarDeNovo(d);
            const parado = ocupado !== null;
            return (
              <li key={d.id} className="opi-inset min-w-0 px-3 py-2.5">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1.5">
                  <IconeDaRede rede={d.rede} className="h-5 w-5" />
                  <span className="min-w-0 truncate text-sm font-semibold text-foreground">{d.nome}</span>
                  <SeloDestino destino={d} semRede />
                  {publicadoEm && <span className="text-xs text-foreground/80">{publicadoEm}</span>}
                </div>

                {link && (
                  <p className="mt-1.5 text-sm">
                    <a
                      href={link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex min-h-9 items-center font-medium text-foreground underline underline-offset-2"
                    >
                      Ver publicação no {d.nome}
                      <span className="sr-only"> (abre em outra aba)</span>
                    </a>
                  </p>
                )}

                {d.status === "ERRO" && (
                  <p className="mt-1.5 break-words text-sm text-error">
                    {erroLegivel(d.erro)}
                    {d.tentativas > 0 && (
                      <span className="text-foreground/80">
                        {" "}
                        ({d.tentativas} {d.tentativas === 1 ? "tentativa" : "tentativas"})
                      </span>
                    )}
                  </p>
                )}
                {d.status === "PULADO" && d.erro && (
                  <p className="mt-1.5 break-words text-sm text-foreground/80">{erroLegivel(d.erro)}</p>
                )}
                {aprovavel && (
                  <p className="mt-1.5 text-sm text-foreground/80">O {d.nome} só publica depois que você aprovar este destino.</p>
                )}

                {(aprovavel || repetivel) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {repetivel && (
                      <button
                        type="button"
                        disabled={parado}
                        onClick={() =>
                          void enviar(d, { tentarDeNovo: true }, `${d.nome} voltou para a fila de publicação.`)
                        }
                        className={`${botaoAcao} border-border-hover text-foreground hover:bg-surface-hover`}
                      >
                        {ocupado === `${d.rede}:repetir` ? "Enviando..." : "Tentar de novo"}
                        <span className="sr-only"> no {d.nome}</span>
                      </button>
                    )}
                    {aprovavel && (
                      <button
                        type="button"
                        disabled={parado}
                        onClick={() => void aprovar(d)}
                        className={`${botaoAcao} border-accent bg-accent/10 font-semibold text-foreground hover:bg-accent/20`}
                      >
                        {ocupado === `${d.rede}:aprovar` ? "Aprovando..." : "Aprovar"}
                        <span className="sr-only"> destino {d.nome}</span>
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {erro && (
        <p role="alert" className="text-sm text-error">
          {erro}
        </p>
      )}
      <p aria-live="polite" className={aviso ? "text-sm text-foreground" : "sr-only"}>
        {aviso}
      </p>
    </section>
  );
}
