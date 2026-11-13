// Bloco "Hoje" no topo do Dashboard: o que sai hoje, o que deu erro nas últimas 24 h e o que espera o Luan.
// Cada linha leva para a tela que resolve. Dados de lib/opi/hoje.ts.
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card } from "@/components/opi";
import { EstadoBloco } from "@/components/opi/visao/estado-bloco";
import { rotuloStatusPost, rotuloTipoPost, tomDoStatus, type Hoje, type ItemHoje, type PostDeHoje } from "@/lib/opi/hoje";
import { LINKS } from "@/lib/opi/visao-geral";

const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

function Coluna({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <h3 className="opi-label mb-2.5">{titulo}</h3>
      {children}
    </div>
  );
}

function Vazio({ children }: { children: ReactNode }) {
  return <p className="text-sm text-muted">{children}</p>;
}

function LinhaPost({ p }: { p: PostDeHoje }) {
  const ativas = p.campanhas.filter((c) => c.ativa).length;
  return (
    <li>
      <Link href={LINKS.calendario} className="opi-inset block px-3 py-2.5 transition-colors hover:bg-white/70">
        <span className="flex flex-wrap items-center gap-2">
          <span className="opi-num text-base leading-none">{fmtHora.format(p.agendadoPara)}</span>
          <span className="text-xs font-semibold text-muted">{rotuloTipoPost(p.tipo)}</span>
          <Badge tone={tomDoStatus(p.status)}>{rotuloStatusPost(p.status)}</Badge>
          {p.campanhas.length > 0 ? (
            <Badge tone={ativas > 0 ? "success" : "neutral"}>
              {p.campanhas.length === 1 ? `DM: ${p.campanhas[0].nome}` : `${p.campanhas.length} campanhas de DM`}
              {ativas === 0 ? " (pausada)" : ""}
            </Badge>
          ) : (
            <Badge>Sem campanha de DM</Badge>
          )}
        </span>
        <span className="mt-1.5 block truncate text-sm text-foreground">{p.legenda || "Sem legenda"}</span>
      </Link>
    </li>
  );
}

function Itens({ itens }: { itens: ItemHoje[] }) {
  return (
    <ul className="grid gap-2">
      {itens.map((i, n) => (
        <li key={`${i.href}-${n}`}>
          <Link href={i.href} className="opi-inset flex items-start justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-white/70">
            <span className="flex min-w-0 items-start gap-2 text-foreground">
              <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.nivel === "erro" ? "bg-error" : "bg-muted"}`} />
              <span className="min-w-0 break-words">{i.texto}</span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-accent">Abrir →</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function BlocoHoje({ hoje }: { hoje: Hoje }) {
  return (
    <Card title="Hoje">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Coluna titulo="Sai hoje">
          <EstadoBloco bloco={hoje.saiHoje}>
            {(posts) =>
              posts.length === 0 ? (
                <Vazio>
                  Nada agendado para hoje.{" "}
                  <Link href={LINKS.calendario} className="font-semibold text-accent hover:underline">
                    Abrir o calendário →
                  </Link>
                </Vazio>
              ) : (
                <ul className="grid gap-2">
                  {posts.map((p) => (
                    <LinhaPost key={p.id} p={p} />
                  ))}
                </ul>
              )
            }
          </EstadoBloco>
        </Coluna>
        <Coluna titulo="Erros nas últimas 24 h">
          <EstadoBloco bloco={hoje.erros}>
            {(itens) => (itens.length === 0 ? <Vazio>Nenhum erro nas últimas 24 horas.</Vazio> : <Itens itens={itens} />)}
          </EstadoBloco>
        </Coluna>
        <Coluna titulo="Esperando você">
          <EstadoBloco bloco={hoje.esperando}>
            {(itens) => (itens.length === 0 ? <Vazio>Nada esperando por você.</Vazio> : <Itens itens={itens} />)}
          </EstadoBloco>
        </Coluna>
      </div>
    </Card>
  );
}
