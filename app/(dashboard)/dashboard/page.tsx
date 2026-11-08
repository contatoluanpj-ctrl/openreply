// Dashboard principal do OPI Central (substitui o antigo painel do Instagram do OpenReply e a Visão geral).
// Layout do Painel OPI: cabeçalho, faixa de KPIs, cards por rede, gráficos para decidir e pendências.
// Só leitura e só dados do banco (lib/opi/dashboard-dados.ts e lib/opi/visao-geral.ts).
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge, PageHeader } from "@/components/opi";
import { Kpi, Pendencias } from "@/components/opi/dashboard/blocos";
import { brl, numero, pct } from "@/components/opi/dashboard/formato";
import {
  GraficoAudiencia,
  GraficoDms,
  GraficoHorario,
  GraficoPalavras,
  GraficoSeguidores,
} from "@/components/opi/dashboard/graficos";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { carregarDashboard } from "@/lib/opi/dashboard-dados";
import { LINKS, carregarVisaoGeral, montarPendencias, type Bloco } from "@/lib/opi/visao-geral";

export const dynamic = "force-dynamic";

const TRACO = "—";
const INDISPONIVEL = "Indisponível agora";

function seOk<T>(b: Bloco<T>, f: (d: T) => string, vazio = TRACO): string {
  return b.ok ? f(b.dados) : vazio;
}

const fmtHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});
const fmtMes = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", month: "long" });

function TituloSecao({ titulo, nota, href, link }: { titulo: string; nota: string; href?: string; link?: string }) {
  return (
    <div className="mb-4 mt-12 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h2 className="font-display text-[22px] font-extrabold tracking-tight text-foreground">{titulo}</h2>
        <p className="mt-1 max-w-[70ch] text-[13px] text-muted">{nota}</p>
      </div>
      {href && link && (
        <Link href={href} className="text-xs font-semibold text-accent hover:underline">
          {link} →
        </Link>
      )}
    </div>
  );
}

export default async function DashboardPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) redirect("/login");

  const agora = new Date();
  const [d, v] = await Promise.all([carregarDashboard(prisma, workspaceId, agora), carregarVisaoGeral(prisma, workspaceId, agora)]);
  const pendencias = montarPendencias(v);
  const erros = pendencias.filter((p) => p.nivel === "erro").length;
  const { seguidores, dms7d, taxa, posts, gasto } = d.kpis;
  const mes = fmtMes.format(agora);

  return (
    <div className="pb-10">
      <PageHeader
        title="Dashboard"
        description="O estado da OPI em uma tela: audiência, DMs, conteúdo, dinheiro e o que depende de você."
        actions={
          <>
            <span className="text-xs text-muted">Atualizado em {fmtHora.format(agora)}</span>
            {pendencias.length === 0 ? (
              <Badge tone="success">Tudo em dia</Badge>
            ) : (
              <a href="#pendencias">
                <Badge tone={erros > 0 ? "error" : "neutral"}>
                  {pendencias.length} {pendencias.length === 1 ? "pendência" : "pendências"}
                </Badge>
              </a>
            )}
          </>
        }
      />

      <section aria-label="Resumo" className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <Kpi
          icone="users"
          rotulo="Seguidores"
          href={LINKS.redes}
          valor={seOk(seguidores, (s) => (s.valor !== null ? numero(s.valor) : TRACO))}
          delta={seguidores.ok ? seguidores.dados.delta : null}
          dica={
            !seguidores.ok
              ? INDISPONIVEL
              : seguidores.dados.redes > 0
                ? `${seguidores.dados.redes} ${seguidores.dados.redes === 1 ? "rede" : "redes"} · variação em 7 dias`
                : "Nenhuma rede coletada ainda"
          }
        />
        <Kpi
          icone="msg"
          rotulo="DMs enviadas 7d"
          href={LINKS.registroDms}
          valor={seOk(dms7d, (x) => numero(x.valor ?? 0))}
          delta={dms7d.ok ? dms7d.dados.delta : null}
          dica={dms7d.ok ? `${numero(dms7d.dados.anterior ?? 0)} nos 7 dias anteriores` : INDISPONIVEL}
        />
        <Kpi
          icone="act"
          rotulo="Comentário → DM"
          href={LINKS.palavras}
          valor={seOk(taxa, (x) => (x.valor !== null ? pct(x.valor) : TRACO))}
          delta={taxa.ok ? taxa.dados.delta : null}
          pp
          dica={
            taxa.ok
              ? taxa.dados.comentarios > 0
                ? `${numero(taxa.dados.enviadas)} de ${numero(taxa.dados.comentarios)} comentários em 30 dias`
                : "Sem comentários de campanha em 30 dias"
              : INDISPONIVEL
          }
        />
        <Kpi
          icone="play"
          rotulo="Posts no mês"
          href={LINKS.calendario}
          valor={seOk(posts, (x) => numero(x.valor ?? 0))}
          delta={posts.ok ? posts.dados.delta : null}
          dica={posts.ok ? `publicados em ${mes} · ${numero(posts.dados.agendados)} agendados` : INDISPONIVEL}
        />
        <Kpi
          icone="coin"
          rotulo="Gasto do mês"
          href={LINKS.financeiro}
          valor={seOk(gasto, (x) => brl(x.valor ?? 0))}
          delta={gasto.ok ? gasto.dados.delta : null}
          dica={gasto.ok ? `pago em ${mes} · ${brl(gasto.dados.previsto)} previstos` : INDISPONIVEL}
        />
      </section>

      <TituloSecao
        titulo="Para decidir"
        nota="Cada gráfico responde uma pergunta: o que postar mais, se a DM converte e quando a audiência está acordada."
      />
      <section aria-label="Gráficos" className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <GraficoSeguidores bloco={d.seguidores} className="lg:col-span-2" />
        <GraficoAudiencia bloco={d.audiencia} />
        <GraficoDms bloco={d.dms} className="lg:col-span-2" />
        <GraficoPalavras bloco={d.palavras} />
        <GraficoHorario bloco={d.horario} className="lg:col-span-3" />
      </section>

      <div id="pendencias" className="scroll-mt-6">
        <TituloSecao titulo="Pendências" nota="O que depende de você agora, com o atalho para resolver." />
        <Pendencias itens={pendencias} />
      </div>
    </div>
  );
}
