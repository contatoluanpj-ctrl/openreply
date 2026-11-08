import Link from "next/link";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { Badge, Card, PageHeader, StatTile } from "@/components/opi";
import { EstadoBloco, ListaPendencias } from "@/components/opi/visao";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import {
  LINKS,
  carregarVisaoGeral,
  formatarBRL,
  formatarDataHora,
  formatarNumero,
  montarPendencias,
  type Bloco,
} from "@/lib/opi/visao-geral";

export const dynamic = "force-dynamic";

const TRACO = "—";

function valor<T>(b: Bloco<T>, f: (d: T) => string): string {
  return b.ok ? f(b.dados) : TRACO;
}

function LinkCard({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="text-xs text-muted hover:text-foreground">
      {children} →
    </Link>
  );
}

function Linha({ rotulo, valor, tom }: { rotulo: string; valor: number | string; tom?: "success" | "error" }) {
  const cor = tom === "success" ? "text-success" : tom === "error" ? "text-error" : "text-foreground";
  return (
    <div>
      <dt className="text-xs text-muted">{rotulo}</dt>
      <dd className={`mt-0.5 text-base font-semibold tabular-nums ${cor}`}>
        {typeof valor === "number" ? formatarNumero(valor) : valor}
      </dd>
    </div>
  );
}

export default async function VisaoGeralPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) redirect("/login");

  const v = await carregarVisaoGeral(prisma, workspaceId);
  const pendencias = montarPendencias(v);
  const erros = pendencias.filter((p) => p.nivel === "erro").length;

  const redesComNumero = v.redes.ok ? v.redes.dados.filter((r) => r.seguidores !== null) : [];
  const totalSeguidores = redesComNumero.reduce((t, r) => t + (r.seguidores ?? 0), 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Visão geral"
        description="Resumo da OPI: redes, campanhas, calendário, caixa e agentes em um só lugar."
        actions={
          pendencias.length === 0 ? (
            <Badge tone="success">Tudo em dia</Badge>
          ) : (
            <Badge tone={erros > 0 ? "error" : "neutral"}>
              {pendencias.length} {pendencias.length === 1 ? "pendência" : "pendências"}
            </Badge>
          )
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Seguidores"
          value={redesComNumero.length > 0 ? formatarNumero(totalSeguidores) : TRACO}
          hint={
            !v.redes.ok
              ? "Indisponível"
              : redesComNumero.length > 0
                ? `Somando ${redesComNumero.length} ${redesComNumero.length === 1 ? "rede" : "redes"}`
                : "Nenhuma rede coletada ainda"
          }
        />
        <StatTile
          label="DMs enviadas hoje"
          value={valor(v.dms, (d) => formatarNumero(d.hoje))}
          hint={v.dms.ok ? `${formatarNumero(v.dms.dados.seteDias)} nos últimos 7 dias` : "Indisponível"}
          tone={v.dms.ok && v.dms.dados.hoje > 0 ? "success" : "neutral"}
        />
        <StatTile
          label="Posts publicados na semana"
          value={valor(v.posts, (d) => formatarNumero(d.publicados))}
          hint={v.posts.ok ? `${formatarNumero(v.posts.dados.agendados)} agendados` : "Indisponível"}
        />
        <StatTile
          label="Custos pagos no mês"
          value={valor(v.caixa, (d) => formatarBRL(d.despesasPagas))}
          hint={v.caixa.ok ? `${formatarBRL(v.caixa.dados.despesasPrevistas)} previstos` : "Indisponível"}
        />
      </div>

      <Card title="Pendências">
        <ListaPendencias itens={pendencias} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Redes" actions={<LinkCard href={LINKS.redes}>Ver redes</LinkCard>}>
          <EstadoBloco bloco={v.redes} vazio={(d) => (d.length === 0 ? "Nenhuma rede coletada ainda." : null)}>
            {(redes) => (
              <ul className="divide-y divide-border text-sm">
                {redes.map((r) => (
                  <li key={r.rede} className="flex items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="capitalize text-foreground">{r.rede}</span>
                      <span className="ml-2 text-xs text-muted">{formatarDataHora(r.coletadoEm)}</span>
                    </span>
                    <span className="tabular-nums text-foreground">
                      {r.seguidores !== null ? formatarNumero(r.seguidores) : TRACO}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </EstadoBloco>
        </Card>

        <Card title="Calendário da semana" actions={<LinkCard href={LINKS.calendario}>Abrir calendário</LinkCard>}>
          <EstadoBloco
            bloco={v.posts}
            vazio={(d) =>
              d.publicados + d.agendados + d.rascunhos + d.erros + d.semAviso === 0 ? "Nenhum post nesta semana." : null
            }
          >
            {(d) => (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Linha rotulo="Publicados" valor={d.publicados} tom={d.publicados > 0 ? "success" : undefined} />
                <Linha rotulo="Agendados (aprovados)" valor={d.agendados} />
                <Linha rotulo="Aguardando aprovação" valor={d.rascunhos} />
                <Linha rotulo="Com erro" valor={d.erros} tom={d.erros > 0 ? "error" : undefined} />
                <Linha rotulo="Legendas sem aviso" valor={d.semAviso} tom={d.semAviso > 0 ? "error" : undefined} />
              </dl>
            )}
          </EstadoBloco>
          <p className="mt-3 text-xs text-muted">Só sai post de calendário aprovado pelo Luan.</p>
        </Card>

        <Card title="DMs e campanhas" actions={<LinkCard href={LINKS.campanhas}>Ver campanhas</LinkCard>}>
          <div className="space-y-4">
            <EstadoBloco bloco={v.dms}>
              {(d) => (
                <dl className="grid grid-cols-3 gap-3 text-sm">
                  <Linha rotulo="Hoje" valor={d.hoje} tom={d.hoje > 0 ? "success" : undefined} />
                  <Linha rotulo="7 dias" valor={d.seteDias} />
                  <Linha rotulo="Em revisão" valor={d.emRevisao} tom={d.emRevisao > 0 ? "error" : undefined} />
                </dl>
              )}
            </EstadoBloco>
            <EstadoBloco bloco={v.campanhas}>
              {(c) => (
                <div className="space-y-2">
                  {c.freioPuxado && <Badge tone="error">Freio da DM puxado</Badge>}
                  {c.totalPausadas === 0 ? (
                    <p className="text-sm text-muted">Nenhuma campanha pausada.</p>
                  ) : (
                    <>
                      <p className="text-xs font-medium uppercase tracking-wide text-muted">
                        Pausadas ({formatarNumero(c.totalPausadas)})
                      </p>
                      <ul className="space-y-1 text-sm">
                        {c.pausadas.map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-2">
                            <Link href={`/campaigns/${a.id}`} className="truncate text-foreground hover:text-muted">
                              {a.name}
                            </Link>
                            <Badge tone="error">Pausada</Badge>
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </div>
              )}
            </EstadoBloco>
          </div>
        </Card>

        <Card title="Caixa do mês" actions={<LinkCard href={LINKS.financeiro}>Abrir financeiro</LinkCard>}>
          <EstadoBloco
            bloco={v.caixa}
            vazio={(d) => (d.lancamentosNoMes === 0 && d.vencidos === 0 ? "Sem lançamentos no mês." : null)}
          >
            {(d) => (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <Linha rotulo="Despesas pagas" valor={formatarBRL(d.despesasPagas)} />
                <Linha rotulo="Despesas previstas" valor={formatarBRL(d.despesasPrevistas)} />
                <Linha rotulo="Receitas recebidas" valor={formatarBRL(d.receitasPagas)} />
                <Linha rotulo="Receitas previstas" valor={formatarBRL(d.receitasPrevistas)} />
                {d.vencidos > 0 && <Linha rotulo="Previstos vencidos" valor={d.vencidos} />}
              </dl>
            )}
          </EstadoBloco>
          <p className="mt-3 text-xs text-muted">Ads só em leitura: nenhum gasto sai daqui.</p>
        </Card>

        <Card
          title="Pedidos aos agentes"
          className="lg:col-span-2"
          actions={<LinkCard href={LINKS.agentes}>Abrir agentes</LinkCard>}
        >
          <EstadoBloco
            bloco={v.agentes}
            vazio={(d) => (d.totalEmAndamento === 0 && d.errosRecentes === 0 ? "Nenhum pedido em andamento." : null)}
          >
            {(d) => (
              <div className="space-y-2">
                {d.errosRecentes > 0 && <Badge tone="error">{d.errosRecentes} com erro nos últimos 7 dias</Badge>}
                {d.emAndamento.length === 0 ? (
                  <p className="text-sm text-muted">Nenhum pedido em andamento.</p>
                ) : (
                  <ul className="divide-y divide-border text-sm">
                    {d.emAndamento.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                        <span className="min-w-0">
                          <span className="font-medium text-foreground">{p.agente}</span>
                          <span className="ml-2 text-muted">{p.mensagem}</span>
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <span className="text-xs text-muted">{formatarDataHora(p.createdAt)}</span>
                          <Badge>{p.status === "NOVO" ? "Novo" : "Em andamento"}</Badge>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
                {d.totalEmAndamento > d.emAndamento.length && (
                  <p className="text-xs text-muted">e mais {d.totalEmAndamento - d.emAndamento.length} em aberto</p>
                )}
              </div>
            )}
          </EstadoBloco>
        </Card>
      </div>
    </div>
  );
}
