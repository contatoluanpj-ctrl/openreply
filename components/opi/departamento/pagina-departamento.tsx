// Página padrão de departamento: o que espera o Luan, as telas, os pedidos em aberto e quem cuida.
// Só apresentação: recebe os dados prontos (lib/opi/departamento-dados.ts). Sem nome nem telefone de lead.
import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, PageHeader } from "@/components/opi";
import { EstadoBloco } from "@/components/opi/visao/estado-bloco";
import { STATUS_LABEL, nomeDoAgente, type MembroEquipe } from "@/lib/opi/agentes";
import { iniciais } from "@/lib/opi/agentes-dados";
import type { DadosDepartamento, PedidoAberto } from "@/lib/opi/departamento-dados";
import { pessoasDoDepartamento, type Departamento, type Ferramenta, type ItemPendencia } from "@/lib/opi/departamentos";
import { LINKS } from "@/lib/opi/visao-geral";

const fmtQuando = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const STATUS_PEDIDO: Record<PedidoAberto["status"], { label: string; tone: "neutral" | "success" }> = {
  NOVO: { label: "Na fila", tone: "neutral" },
  EM_ANDAMENTO: { label: "Em andamento", tone: "success" },
};

function Vazio({ children }: { children: ReactNode }) {
  return <p className="text-sm leading-relaxed text-muted">{children}</p>;
}

function Pessoa({ membro, destaque = false }: { membro: MembroEquipe; destaque?: boolean }) {
  return (
    <div className="opi-inset flex min-w-0 items-center gap-3 px-3 py-2.5">
      <span
        aria-hidden
        className={`grid shrink-0 place-items-center rounded-full font-display font-extrabold ${
          destaque ? "h-10 w-10 bg-foreground text-xs text-background" : "h-8 w-8 border border-border bg-inset text-[10px] text-foreground"
        }`}
      >
        {iniciais(membro.nome)}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground [overflow-wrap:anywhere]">{membro.nome}</span>
        <span className="block text-xs text-muted">
          {membro.papel}
          {membro.status ? ` · ${STATUS_LABEL[membro.status]}` : ""}
        </span>
      </span>
    </div>
  );
}

function Tela({ f }: { f: Ferramenta }) {
  return (
    <Link href={f.href} className="opi-inset flex min-h-14 items-center justify-between gap-3 px-3.5 py-3 transition-colors hover:bg-surface-hover">
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-foreground">{f.label}</span>
        <span className="mt-0.5 block text-xs leading-snug text-muted">{f.descricao}</span>
      </span>
      <span aria-hidden className="shrink-0 text-sm font-semibold text-accent-text">→</span>
    </Link>
  );
}

function ListaPendencias({ itens }: { itens: ItemPendencia[] }) {
  return (
    <ul className="grid gap-2">
      {itens.map((i, n) => (
        <li key={`${i.href}-${n}`}>
          <Link href={i.href} className="opi-inset flex items-start justify-between gap-3 px-3 py-2.5 text-sm transition-colors hover:bg-surface-hover">
            <span className="flex min-w-0 items-start gap-2 text-foreground">
              <span aria-hidden className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${i.nivel === "erro" ? "bg-error" : "bg-muted"}`} />
              <span className="min-w-0 break-words">
                {i.nivel === "erro" && <span className="sr-only">Erro: </span>}
                {i.texto}
              </span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-accent-text">Abrir →</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ListaPedidos({ pedidos }: { pedidos: PedidoAberto[] }) {
  return (
    <ul className="grid gap-2">
      {pedidos.map((p) => (
        <li key={p.id} className="opi-inset flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-3 py-2.5">
          <span className="min-w-0 text-sm text-foreground">
            Pedido para <b className="font-semibold">{nomeDoAgente(p.agente)}</b>
            <span className="block text-xs text-muted">aberto em {fmtQuando.format(p.createdAt)}</span>
          </span>
          <Badge tone={STATUS_PEDIDO[p.status].tone}>{STATUS_PEDIDO[p.status].label}</Badge>
        </li>
      ))}
    </ul>
  );
}

export function PaginaDepartamento({ dep, dados }: { dep: Departamento; dados: DadosDepartamento }) {
  const { diretor, equipe, apoio } = pessoasDoDepartamento(dep);
  const semTelas = dep.ferramentas.length === 0;
  const atalhos = dep.atalhos ?? [];
  const planejadas = dep.planejadas ?? [];

  return (
    <div className="pb-10">
      <PageHeader title={dep.nome} description={dep.resumo} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Esperando você">
          <EstadoBloco bloco={dados.pendencias}>
            {(itens) =>
              itens.length === 0 ? (
                <Vazio>
                  {semTelas
                    ? "Nada esperando por você. Este departamento ainda não tem telas no painel, então só aparecem aqui os pedidos da equipe."
                    : "Nada esperando por você neste departamento."}
                </Vazio>
              ) : (
                <ListaPendencias itens={itens} />
              )
            }
          </EstadoBloco>
        </Card>

        <Card title="Ferramentas">
          {semTelas && atalhos.length === 0 ? (
            <Vazio>Este departamento ainda não tem telas no painel.</Vazio>
          ) : (
            <div className="grid gap-2">
              {dep.ferramentas.map((f) => (
                <Tela key={f.href} f={f} />
              ))}
              {atalhos.length > 0 && (
                <>
                  <p className="opi-label mt-2">{semTelas ? "Ainda sem telas próprias. Atalhos" : "Atalhos"}</p>
                  {atalhos.map((f) => (
                    <Tela key={f.href} f={f} />
                  ))}
                </>
              )}
            </div>
          )}
          {planejadas.length > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-muted">
              Ainda sem tela: {planejadas.join(", ")}.
            </p>
          )}
        </Card>

        <Card
          title="Pedidos em aberto"
          actions={
            <Link href={LINKS.agentes} className="text-xs font-semibold text-accent-text hover:underline">
              Abrir Agentes →
            </Link>
          }
        >
          <EstadoBloco bloco={dados.pedidos}>
            {(pedidos) =>
              pedidos.length === 0 ? (
                <Vazio>Nenhum pedido em aberto para a equipe deste departamento.</Vazio>
              ) : (
                <>
                  <ListaPedidos pedidos={pedidos} />
                  <p className="mt-3 text-xs text-muted">O texto e a resposta de cada pedido ficam em Agentes.</p>
                </>
              )
            }
          </EstadoBloco>
        </Card>

        <Card title="Diretor e equipe">
          {diretor ? (
            <div className="grid gap-2">
              <p className="opi-label">Diretor</p>
              <Pessoa membro={diretor} destaque />
              {apoio.length > 0 && (
                <>
                  <p className="opi-label mt-2">Também atua aqui</p>
                  {apoio.map((m) => (
                    <Pessoa key={m.id} membro={m} />
                  ))}
                </>
              )}
              <p className="opi-label mt-2">Equipe</p>
              {equipe.length === 0 ? (
                <Vazio>Sem equipe própria no registro de agentes.</Vazio>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {equipe.map((m) => (
                    <Pessoa key={m.id} membro={m} />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <Vazio>Sem diretor definido no registro de agentes.</Vazio>
          )}
        </Card>
      </div>
    </div>
  );
}
