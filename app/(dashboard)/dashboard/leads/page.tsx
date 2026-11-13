// Leads e funil (/dashboard/leads): do comentário com a palavra até o lead que aceitou contato, por material.
// Só leitura e só números. Comentários e DMs vêm do DmLog (campanhas ativas); formulário e leads vêm do webhook
// de leitura do n8n (lib/opi/leads-funil.ts). Sem a fonte de leads, as etapas do DmLog aparecem do mesmo jeito.
import { redirect } from "next/navigation";
import { Badge, Card, PageHeader, StatTile } from "@/components/opi";
import { numero, pct } from "@/components/opi/dashboard/formato";
import { EstadoBloco } from "@/components/opi/visao/estado-bloco";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import type { LogDm } from "@/lib/opi/dashboard-dados";
import { buscarFunil, diasAteMeta, montarFunil, semanasDoFunil, type LinhaFunil } from "@/lib/opi/leads-funil";
import { bloco } from "@/lib/opi/visao-geral";

export const dynamic = "force-dynamic";

const TRACO = "—";
const fmtHora = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const pctOuTraco = (v: number | null | undefined) => (v === null || v === undefined ? TRACO : pct(v));

function LinhaTabela({ l, comFormulario }: { l: LinhaFunil; comFormulario: boolean }) {
  const f = l.formulario;
  return (
    <tr className="border-t border-border">
      <th scope="row" className="py-3 pr-4 text-left align-top">
        <span className="font-semibold text-foreground">{l.nome}</span>
        {l.palavras.length > 0 && l.palavras.join(", ") !== l.nome && (
          <span className="block text-xs font-normal text-muted">{l.palavras.join(", ")}</span>
        )}
      </th>
      <td className="py-3 pr-4 text-right tabular-nums">{numero(l.comentarios)}</td>
      <td className="py-3 pr-4 text-right tabular-nums">
        {numero(l.dms)}
        <span className="block text-xs text-muted">{pctOuTraco(l.taxaDmPct)}</span>
      </td>
      {comFormulario && (
        <>
          <td className="py-3 pr-4 text-right tabular-nums">{f ? numero(f.aberturas) : TRACO}</td>
          <td className="py-3 pr-4 text-right tabular-nums">{f ? numero(f.envios) : TRACO}</td>
          <td className="py-3 pr-4 text-right tabular-nums">{pctOuTraco(f?.desistenciaPct)}</td>
          <td className="py-3 text-right tabular-nums">
            {pctOuTraco(f?.aceitePct)}
            {f && <span className="block text-xs text-muted">{numero(f.aceiteContato)} de {numero(f.leads > 0 ? f.leads : f.envios)}</span>}
          </td>
        </>
      )}
    </tr>
  );
}

export default async function LeadsPage() {
  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) redirect("/login");

  const agora = new Date();
  const [logs, fonte] = await Promise.all([
    bloco(async () => {
      const linhas = await prisma.dmLog.findMany({
        where: { workspaceId },
        // Só o que o funil conta: nada de nome, usuário ou texto do comentário.
        select: { createdAt: true, dmSentAt: true, status: true, matchedKeyword: true, automation: { select: { name: true, isActive: true } } },
        orderBy: { createdAt: "desc" },
        take: 50000,
      });
      return linhas.map(
        (l): LogDm => ({
          createdAt: l.createdAt,
          dmSentAt: l.dmSentAt,
          status: String(l.status),
          matchedKeyword: l.matchedKeyword,
          campanha: l.automation?.name ?? "",
          campanhaAtiva: l.automation?.isActive ?? true,
        }),
      );
    }),
    buscarFunil(),
  ]);

  const funil = montarFunil(logs.ok ? logs.dados : [], fonte.ok ? fonte.dados : null);
  const semanas = fonte.ok ? semanasDoFunil(fonte.dados.porSemana) : [];
  const avisoFonte = fonte.ok
    ? null
    : fonte.motivo === "nao_configurada"
      ? "Fonte de leads não configurada"
      : "Fonte de leads indisponível";
  const detalheFonte =
    !fonte.ok && fonte.motivo === "indisponivel"
      ? "As etapas de formulário voltam quando o n8n responder. Comentários e DMs abaixo seguem normais."
      : "As etapas de formulário (aberturas, envios, desistência e aceite de contato) aparecem quando o webhook de leitura do n8n for ligado ao painel.";
  const dias = diasAteMeta(agora);

  return (
    <div className="pb-10">
      <PageHeader
        title="Leads e funil"
        description="Do comentário com a palavra até o lead que aceitou contato, por material. Só números: nenhum nome ou telefone de lead aparece no painel."
        actions={
          fonte.ok ? (
            <span className="text-xs text-muted">Leads atualizados em {fmtHora.format(new Date(fonte.dados.atualizadoEm))}</span>
          ) : (
            <Badge tone="error">{avisoFonte}</Badge>
          )
        }
      />

      <section aria-label="Resumo" className="grid grid-cols-1 gap-3 min-[480px]:grid-cols-2 lg:grid-cols-4">
        <StatTile
          label="Leads com contato até 13/12"
          value={funil.leadsComContato !== null ? numero(funil.leadsComContato) : TRACO}
          hint={
            funil.leadsComContato !== null
              ? dias > 0
                ? `total atual · ${dias === 1 ? "falta 1 dia" : `faltam ${dias} dias`}`
                : "total atual · prazo encerrado"
              : avisoFonte
          }
        />
        <StatTile
          label="Comentários com a palavra"
          value={logs.ok ? numero(funil.total.comentarios) : TRACO}
          hint={logs.ok ? "campanhas ativas, dos 5 materiais" : "Indisponível agora"}
        />
        <StatTile
          label="DMs enviadas"
          value={logs.ok ? numero(funil.total.dms) : TRACO}
          hint={
            logs.ok && funil.total.comentarios > 0
              ? `${pct(Math.round((funil.total.dms / funil.total.comentarios) * 1000) / 10)} dos comentários`
              : "sem comentários ainda"
          }
        />
        <StatTile
          label="Formulários enviados"
          value={fonte.ok ? numero(funil.total.envios) : TRACO}
          hint={fonte.ok ? `${numero(funil.total.aberturas)} aberturas` : avisoFonte}
        />
      </section>

      <Card title="Etapas por material" className="mt-6">
        <EstadoBloco bloco={logs}>
          {() => (
            <>
              {avisoFonte && (
                <p role="status" className="mb-4 rounded-xl border border-error/40 bg-error/10 px-3 py-2.5 text-sm text-error">
                  <strong>{avisoFonte}.</strong>{" "}
                  {detalheFonte}
                </p>
              )}
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-[.08em] text-muted">
                      <th scope="col" className="pb-2 pr-4 text-left font-semibold">Material</th>
                      <th scope="col" className="pb-2 pr-4 text-right font-semibold">Comentários</th>
                      <th scope="col" className="pb-2 pr-4 text-right font-semibold">DMs enviadas</th>
                      {fonte.ok && (
                        <>
                          <th scope="col" className="pb-2 pr-4 text-right font-semibold">Aberturas</th>
                          <th scope="col" className="pb-2 pr-4 text-right font-semibold">Envios</th>
                          <th scope="col" className="pb-2 pr-4 text-right font-semibold">Desistência</th>
                          <th scope="col" className="pb-2 text-right font-semibold">Aceitou contato</th>
                        </>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {funil.linhas.map((l) => (
                      <LinhaTabela key={l.id} l={l} comFormulario={fonte.ok} />
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-4 text-xs leading-relaxed text-muted">
                Comentários e DMs: registro de DMs do painel, só campanhas ativas, desde o início. Desistência = (aberturas − envios) ÷
                aberturas. Aceitou contato = leads que marcaram o aceite ÷ leads do material.
              </p>
            </>
          )}
        </EstadoBloco>
      </Card>

      {funil.outras.length > 0 && (
        <Card title="Outras palavras" className="mt-4">
          <p className="mb-3 text-sm text-muted">Palavras de campanha ativa que não entregam um dos 5 materiais. Não têm formulário.</p>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-[.08em] text-muted">
                  <th scope="col" className="pb-2 pr-4 text-left font-semibold">Palavra</th>
                  <th scope="col" className="pb-2 pr-4 text-right font-semibold">Comentários</th>
                  <th scope="col" className="pb-2 pr-4 text-right font-semibold">DMs enviadas</th>
                </tr>
              </thead>
              <tbody>
                {funil.outras.map((l) => (
                  <LinhaTabela key={l.id} l={l} comFormulario={false} />
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card title="Leads por semana" className="mt-4">
        {!fonte.ok ? (
          <p className="text-sm text-muted">{avisoFonte}.</p>
        ) : semanas.length === 0 ? (
          <p className="text-sm text-muted">Nenhum lead registrado ainda.</p>
        ) : (
          <ul className="grid gap-2">
            {semanas.map((s) => (
              <li key={s.semana} className="grid grid-cols-[4.5rem_1fr_3rem] items-center gap-3 text-sm">
                <span className="text-muted">Sem. {s.rotulo}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-[#111217]/[0.06]" aria-hidden>
                  <span className="block h-full rounded-full bg-accent" style={{ width: `${s.largura}%` }} />
                </span>
                <span className="text-right font-semibold tabular-nums text-foreground">{numero(s.leads)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
