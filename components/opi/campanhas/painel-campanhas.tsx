"use client";

// Gráficos de decisão do topo da página Campanhas, no estilo do Painel OPI (vidro, pílulas, d3 → recharts).
// Dados: /api/opi/campanhas-stats (DmLog e Automation do workspace). Nada é inventado: sem linhas, estado vazio.
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { Periodo, StatsCampanhas } from "@/lib/opi/campanhas-dados";

const ACC = "#D9541E";
const INK = "#111217";
const TER = "rgba(17,18,23,.35)";
const QUA = "rgba(17,18,23,.12)";
const GRADE = "rgba(17,18,23,.08)";
const EIXO = { fontSize: 11, fill: "rgba(17,18,23,.5)" };

const fmt = new Intl.NumberFormat("pt-BR");

function diaCurto(dia: string) {
  const [, m, d] = dia.split("-");
  return `${d}/${m}`;
}

export function dataHora(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const Ic = {
  play: <path d="M8 5v14l11-7z" />,
  chat: <path d="M4 5h16v11H8l-4 4z" />,
  send: <path d="M3 11l18-8-8 18-2-8z" />,
  pct: <path d="M5 19L19 5M7 9a2 2 0 100-4 2 2 0 000 4zm10 10a2 2 0 100-4 2 2 0 000 4z" />,
  pause: <path d="M8 5v14M16 5v14" />,
};

function Icone({ d }: { d: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {d}
    </svg>
  );
}

function Kpi({ icone, rotulo, valor, dica, destaque }: { icone: ReactNode; rotulo: string; valor: ReactNode; dica: string; destaque?: boolean }) {
  return (
    <div className="opi-tile">
      <p className="opi-label">
        <Icone d={icone} />
        {rotulo}
      </p>
      <p className={`opi-num mt-1.5 text-[28px] leading-tight ${destaque ? "text-[#D9541E]" : ""}`}>{valor}</p>
      <p className="mt-1 text-xs text-muted">{dica}</p>
    </div>
  );
}

function Grafico({ titulo, olhar, acoes, className = "", children }: { titulo: string; olhar: string; acoes?: ReactNode; className?: string; children: ReactNode }) {
  return (
    <section className={`opi-glass flex min-w-0 flex-col p-[22px] ${className}`}>
      <div className="mb-[18px] flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-display text-base font-bold text-foreground">{titulo}</h4>
          <p className="mt-0.5 text-xs text-muted">{olhar}</p>
        </div>
        {acoes}
      </div>
      {children}
    </section>
  );
}

function Vazio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="flex min-h-[240px] flex-col items-center justify-center px-6 text-center">
      <svg viewBox="0 0 24 24" className="h-7 w-7 text-[#D9541E]/70" fill="none" stroke="currentColor" strokeWidth={1.6} aria-hidden>
        <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" strokeLinecap="round" />
      </svg>
      <b className="mt-2.5 text-sm text-foreground/80">{titulo}</b>
      <small className="mt-1 max-w-[22rem] text-xs leading-relaxed text-muted">{texto}</small>
    </div>
  );
}

type TipItem = { name?: string | number; value?: number | string; color?: string; payload?: Record<string, unknown> };

function Dica({ active, payload, label, rotulo }: { active?: boolean; payload?: TipItem[]; label?: string | number; rotulo?: (l: string) => string }) {
  if (!active || !payload?.length) return null;
  const titulo = label !== undefined && label !== "" ? (rotulo ? rotulo(String(label)) : String(label)) : String(payload[0]?.name ?? "");
  return (
    <div className="opi-tip">
      <i className="block not-italic text-white/60">{titulo}</i>
      {payload.map((p) => (
        <div key={String(p.name)} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          <span className="text-white/80">{p.name}</span>
          <b className="ml-auto pl-3 text-sm">{fmt.format(Number(p.value ?? 0))}</b>
        </div>
      ))}
    </div>
  );
}

function Legenda({ itens }: { itens: { cor: string; nome: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted">
      {itens.map((i) => (
        <span key={i.nome} className="flex items-center gap-1.5">
          <i className="inline-block h-0.5 w-4 rounded" style={{ background: i.cor }} />
          {i.nome}
        </span>
      ))}
    </div>
  );
}

import { PillEstado } from "./pill-estado";

export { PillEstado };

export function PainelCampanhas({ accountId, versao }: { accountId: string; versao: number }) {
  const [periodo, setPeriodo] = useState<Periodo>(30);
  const [dados, setDados] = useState<StatsCampanhas | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    let cancelado = false;
    const p = new URLSearchParams({ dias: String(periodo) });
    if (accountId !== "all") p.set("instagramAccountId", accountId);
    fetch(`/api/opi/campanhas-stats?${p}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        if (cancelado) return;
        if (j.success) {
          setDados(j.data);
          setErro(false);
        } else setErro(true);
      })
      .catch(() => !cancelado && setErro(true));
    return () => {
      cancelado = true;
    };
  }, [periodo, accountId, versao]);

  const seletor = (
    <div className="opi-seg" role="group" aria-label="Período">
      {([7, 30, 90] as const).map((d) => (
        <button key={d} type="button" aria-pressed={periodo === d} onClick={() => setPeriodo(d)}>
          {d}d
        </button>
      ))}
    </div>
  );

  if (erro && !dados) {
    return (
      <div className="opi-glass muted p-6 text-sm text-muted">
        Não foi possível carregar os gráficos agora. A lista de campanhas abaixo continua funcionando.
      </div>
    );
  }

  if (!dados) {
    return (
      <div className="space-y-4" aria-busy>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="opi-tile h-[104px] animate-pulse" />
          ))}
        </div>
        <div className="opi-glass muted h-[320px] animate-pulse" />
      </div>
    );
  }

  const { kpis, porDia, porCampanha, resposta } = dados;
  const semComentarios = kpis.comentarios === 0;
  const topo = porCampanha.filter((c) => c.comentarios > 0).slice(0, 8);
  const fatias = [
    { name: "DM + resposta pública", value: resposta.ambas, color: ACC },
    { name: "Só DM", value: resposta.soDm, color: INK },
    { name: "Só resposta pública", value: resposta.soPublica, color: TER },
    { name: "Nenhuma das duas", value: resposta.nenhuma, color: QUA },
  ];
  const comPublica = resposta.ambas + resposta.soPublica;
  const vazioTexto = `Os números aparecem quando alguém comentar uma palavra-chave num Reel ligado a uma campanha (registro de DMs).`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Últimos {periodo} dias{kpis.total ? ` · ${kpis.total} campanha${kpis.total === 1 ? "" : "s"}` : ""}
        </p>
        {seletor}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi icone={Ic.play} rotulo="Campanhas ativas" valor={`${kpis.ativas}`} dica={`de ${kpis.total} no total`} />
        <Kpi icone={Ic.chat} rotulo={`Comentários ${periodo}d`} valor={fmt.format(kpis.comentarios)} dica="com palavra-chave" />
        <Kpi icone={Ic.send} rotulo={`DMs enviadas ${periodo}d`} valor={fmt.format(kpis.dms)} dica="entregues no Direct" destaque />
        <Kpi icone={Ic.pct} rotulo="Taxa de envio" valor={kpis.taxa === null ? "—" : `${String(kpis.taxa).replace(".", ",")}%`} dica="comentário → DM" />
        <Kpi
          icone={Ic.pause}
          rotulo="Seguradas p/ revisão"
          valor={fmt.format(kpis.seguradas)}
          dica={kpis.seguradas > 0 ? "esperando o seu OK" : "nada esperando"}
        />
      </div>

      {kpis.seguradas > 0 && (
        <Link
          href="/dashboard/palavras"
          className="opi-inset flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-white/40"
        >
          <span>
            <b className="text-[#D9541E]">{kpis.seguradas}</b> DM{kpis.seguradas === 1 ? "" : "s"} segurada
            {kpis.seguradas === 1 ? "" : "s"} pelo Jev esperando revisão.
          </span>
          <span className="text-xs font-semibold text-muted">Revisar →</span>
        </Link>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Grafico
          className="lg:col-span-2"
          titulo={`DMs por dia (${periodo}d)`}
          olhar="Olhe os picos: são os dias em que um Reel puxou comentário. Poste mais daquele formato."
          acoes={<Legenda itens={[{ cor: ACC, nome: "DMs enviadas" }, { cor: TER, nome: "Comentários" }]} />}
        >
          {semComentarios ? (
            <Vazio titulo="Nenhum comentário no período" texto={vazioTexto} />
          ) : (
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={porDia} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
                  <defs>
                    <linearGradient id="opi-camp-area" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACC} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={ACC} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke={GRADE} vertical={false} />
                  <XAxis dataKey="dia" tickFormatter={diaCurto} tick={EIXO} axisLine={false} tickLine={false} minTickGap={24} />
                  <YAxis allowDecimals={false} tick={EIXO} axisLine={false} tickLine={false} width={48} />
                  <Tooltip content={<Dica rotulo={diaCurto} />} cursor={{ stroke: "rgba(17,18,23,.15)" }} />
                  <Area type="monotone" dataKey="comentarios" name="Comentários" stroke={TER} strokeWidth={1.5} fill="none" />
                  <Area type="monotone" dataKey="dms" name="DMs enviadas" stroke={ACC} strokeWidth={2.2} fill="url(#opi-camp-area)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          )}
        </Grafico>

        <Grafico
          titulo="Resposta pública vs DM"
          olhar="Se “Só DM” cresce, a resposta pública não está saindo: quem vê o Reel não sabe que vale comentar."
        >
          {semComentarios ? (
            <Vazio titulo="Sem envios no período" texto="Cada comentário com palavra-chave gera uma DM e, se ligada, uma resposta pública." />
          ) : (
            <div className="flex flex-col items-center">
              <div className="relative h-[190px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={fatias} dataKey="value" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={2} stroke="none">
                      {fatias.map((f) => (
                        <Cell key={f.name} fill={f.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<Dica />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="opi-num text-2xl">{taxa100(comPublica, kpis.comentarios)}</span>
                  <span className="max-w-[5.5rem] text-center text-[10.5px] leading-tight text-muted">com resposta pública</span>
                </div>
              </div>
              <ul className="mt-3 grid w-full gap-1.5 text-xs">
                {fatias.map((f) => (
                  <li key={f.name} className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: f.color }} />
                    <span className="text-muted">{f.name}</span>
                    <b className="ml-auto tabular-nums">{fmt.format(f.value)}</b>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Grafico>

        <Grafico
          className="lg:col-span-3"
          titulo="Desempenho por campanha"
          olhar="Barra laranja curta perto de barra cinza longa = a campanha recebe comentário mas não entrega DM. Confira o texto ou o portão."
          acoes={<Legenda itens={[{ cor: TER, nome: "Comentários" }, { cor: ACC, nome: "DMs enviadas" }]} />}
        >
          {topo.length === 0 ? (
            <Vazio titulo="Nenhuma campanha com comentário no período" texto={vazioTexto} />
          ) : (
            <div style={{ height: Math.max(160, topo.length * 44 + 30) }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topo} layout="vertical" margin={{ top: 0, right: 16, left: 0, bottom: 0 }} barGap={3}>
                  <CartesianGrid stroke={GRADE} horizontal={false} vertical={false} />
                  <XAxis type="number" allowDecimals={false} tick={EIXO} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="nome"
                    tick={EIXO}
                    axisLine={false}
                    tickLine={false}
                    width={140}
                    tickFormatter={(n: string) => (n.length > 20 ? `${n.slice(0, 19)}…` : n)}
                  />
                  <Tooltip content={<Dica />} cursor={{ fill: "rgba(17,18,23,.04)" }} />
                  <Bar dataKey="comentarios" name="Comentários" fill={TER} radius={6} barSize={12} />
                  <Bar dataKey="dms" name="DMs enviadas" fill={ACC} radius={6} barSize={12} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Grafico>
      </div>

      {porCampanha.length > 0 && (
        <section className="opi-glass overflow-hidden">
          <div className="px-[22px] pt-[22px]">
            <h4 className="font-display text-base font-bold text-foreground">Comparativo das campanhas</h4>
            <p className="mt-0.5 text-xs text-muted">Ordenado por comentários no período. Taxa baixa com muito comentário pede revisão.</p>
          </div>
          <div className="mt-3 max-h-[420px] overflow-auto">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="text-left">
                  <th className="whitespace-nowrap px-[14px] py-3">Campanha</th>
                  <th className="whitespace-nowrap px-[14px] py-3">Estado</th>
                  <th className="whitespace-nowrap px-[14px] py-3">Palavras</th>
                  <th className="whitespace-nowrap px-[14px] py-3 text-right">Coment.</th>
                  <th className="whitespace-nowrap px-[14px] py-3 text-right">DMs</th>
                  <th className="whitespace-nowrap px-[14px] py-3 text-right">Taxa</th>
                  <th className="whitespace-nowrap px-[14px] py-3">Último envio</th>
                </tr>
              </thead>
              <tbody>
                {porCampanha.map((c) => (
                  <tr key={c.id} className="border-t border-[#111217]/[.07] align-top tabular-nums">
                    <td className="px-[14px] py-[11px]">
                      <Link href={`/campaigns/${c.id}`} className="font-semibold hover:text-[#D9541E]">
                        {c.nome}
                      </Link>
                      {c.username && <span className="block text-xs text-muted">@{c.username}</span>}
                    </td>
                    <td className="px-[14px] py-[11px]">
                      <PillEstado ativa={c.ativa} />
                    </td>
                    <td className="px-[14px] py-[11px]">
                      <div className="flex max-w-[16rem] flex-wrap gap-1">
                        {c.palavras.slice(0, 4).map((p) => (
                          <span key={p} className="rounded-full bg-[#111217]/[.05] px-2 py-0.5 text-[11px] font-semibold">
                            {p}
                          </span>
                        ))}
                        {c.palavras.length > 4 && <span className="text-[11px] text-muted">+{c.palavras.length - 4}</span>}
                      </div>
                    </td>
                    <td className="px-[14px] py-[11px] text-right">{fmt.format(c.comentarios)}</td>
                    <td className="px-[14px] py-[11px] text-right font-semibold">{fmt.format(c.dms)}</td>
                    <td className="px-[14px] py-[11px] text-right">
                      {c.taxa === null ? <span className="text-muted">—</span> : `${String(c.taxa).replace(".", ",")}%`}
                    </td>
                    <td className="whitespace-nowrap px-[14px] py-[11px] text-muted">{dataHora(c.ultimoEnvio)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function taxa100(parte: number, total: number) {
  if (total <= 0) return "—";
  return `${Math.round((parte / total) * 100)}%`;
}
