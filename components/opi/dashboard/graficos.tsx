"use client";

// Gráficos do Dashboard (recharts) no estilo .opi-chart do Painel OPI: título, frase "o que olhar", seletor de
// período em pílula (opi-seg) e estado vazio explicando de onde virá o dado. Só desenha o que veio do banco.
import { useId, useState, type ReactNode } from "react";
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
import { RedeIcone } from "@/components/opi/redes/rede-icone";
import type {
  DiaDms,
  DiaSeguidores,
  FatiaAudiencia,
  HoraComentarios,
  PalavraConversao,
  Periodo,
  PorPeriodo,
} from "@/lib/opi/dashboard-dados";
import type { Bloco } from "@/lib/opi/visao-geral";
import type { RedeId } from "@/lib/opi/redes";
import { REDE_IDS } from "@/lib/opi/redes";
import { numero, pct } from "./formato";

const COR = {
  principal: "#D9541E",
  secundaria: "#111217",
  terciaria: "rgba(17,18,23,.35)",
  grade: "rgba(17,18,23,.08)",
  eixo: "rgba(17,18,23,.5)",
};
const FATIAS = ["#D9541E", "#111217", "rgba(17,18,23,.35)", "#E8946F", "rgba(17,18,23,.6)", "rgba(217,84,30,.45)", "rgba(17,18,23,.15)"];
const EIXO = { fontSize: 11, fill: COR.eixo };

// ---------------------------------------------------------------------------------------------------------------
// Moldura

function Seletor({ valor, onChange }: { valor: Periodo; onChange: (p: Periodo) => void }) {
  return (
    <div className="opi-seg" role="group" aria-label="Período">
      {([7, 30, 90] as Periodo[]).map((p) => (
        <button key={p} type="button" aria-pressed={valor === p} onClick={() => onChange(p)}>
          {p}d
        </button>
      ))}
    </div>
  );
}

function Vazio({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="flex h-full min-h-[240px] flex-col items-center justify-center px-6 text-center">
      <span className="grid h-10 w-10 place-items-center rounded-2xl bg-[rgba(217,84,30,.12)] text-accent" aria-hidden>
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <path d="M3 3v18h18M7 15l4-4 3 3 5-6" />
        </svg>
      </span>
      <b className="mt-2.5 text-sm text-foreground/70">{titulo}</b>
      <small className="mt-1 max-w-[22rem] text-xs leading-relaxed text-muted">{texto}</small>
    </div>
  );
}

function Grafico({
  titulo,
  olhar,
  acoes,
  className = "",
  children,
}: {
  titulo: string;
  olhar: ReactNode;
  acoes?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`opi-glass flex min-w-0 flex-col p-[22px] ${className}`}>
      <div className="mb-[18px] flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-display text-base font-bold text-foreground">{titulo}</h3>
          <p className="mt-[3px] text-xs text-muted">{olhar}</p>
        </div>
        {acoes}
      </div>
      <div className="relative min-h-[240px] flex-1">{children}</div>
    </section>
  );
}

function SemTabela({ bloco }: { bloco: Bloco<unknown> }) {
  if (bloco.ok) return null;
  return (
    <Vazio
      titulo={bloco.motivo === "sem_tabela" ? "Tabela ainda não criada" : "Não carregou agora"}
      texto={bloco.motivo === "sem_tabela" ? "A migration do OPI Central ainda não foi aplicada neste banco." : "Recarregue a página em instantes."}
    />
  );
}

type ItemDica = { name?: string | number; value?: number | string; color?: string; payload?: Record<string, unknown> };

function Dica({ active, payload, label, titulo }: { active?: boolean; payload?: ItemDica[]; label?: string | number; titulo?: (p: ItemDica[], l?: string | number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="opi-tip">
      <i className="block not-italic text-white/50">{titulo ? titulo(payload, label) : label}</i>
      {payload.map((p) => (
        <div key={String(p.name)} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />
          <span className="text-white/70">{p.name}</span>
          <b className="ml-auto text-sm tabular-nums">{typeof p.value === "number" ? numero(p.value) : p.value}</b>
        </div>
      ))}
    </div>
  );
}

function Legenda({ itens }: { itens: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted">
      {itens.map(([nome, cor]) => (
        <span key={nome} className="flex items-center gap-1.5">
          <i className="inline-block h-2 w-4 rounded-sm" style={{ background: cor }} aria-hidden />
          {nome}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Crescimento de seguidores (área)

export function GraficoSeguidores({ bloco, className }: { bloco: Bloco<PorPeriodo<DiaSeguidores[]>>; className?: string }) {
  const [p, setP] = useState<Periodo>(30);
  const gid = useId().replace(/:/g, "");
  const dados = bloco.ok ? bloco.dados[p] : [];
  const comValor = dados.filter((d) => d.seguidores !== null);
  const primeiro = comValor[0]?.seguidores ?? null;
  const ultimo = comValor[comValor.length - 1]?.seguidores ?? null;
  const ganho = primeiro !== null && ultimo !== null ? ultimo - primeiro : null;

  const olhar =
    ganho === null
      ? "Instagram, soma das contas, dia a dia."
      : ganho > 0
        ? `+${numero(ganho)} seguidores em ${p} dias. Compare os saltos com os dias de post no calendário.`
        : ganho < 0
          ? `${numero(ganho)} seguidores em ${p} dias. Veja se a queda coincide com dias sem post.`
          : `Estável em ${p} dias. Um Reel novo por dia costuma destravar o crescimento.`;

  return (
    <Grafico titulo="Crescimento de seguidores" olhar={olhar} acoes={<Seletor valor={p} onChange={setP} />} className={className}>
      {!bloco.ok ? (
        <SemTabela bloco={bloco} />
      ) : comValor.length < 2 ? (
        <Vazio
          titulo="Ainda sem histórico"
          texto="A linha aparece quando houver pelo menos dois dias de seguidores coletados do Instagram (coleta diária do OpenReply)."
        />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={dados} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={`seg-${gid}`} x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={COR.principal} stopOpacity={0.35} />
                <stop offset="100%" stopColor={COR.principal} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke={COR.grade} />
            <XAxis dataKey="rotulo" tick={EIXO} axisLine={false} tickLine={false} minTickGap={24} />
            <YAxis tick={EIXO} axisLine={false} tickLine={false} width={44} domain={["auto", "auto"]} tickFormatter={(v: number) => numero(v)} />
            <Tooltip content={<Dica />} cursor={{ stroke: COR.grade }} />
            <Area
              type="monotone"
              dataKey="seguidores"
              name="Seguidores"
              stroke={COR.principal}
              strokeWidth={2.5}
              fill={`url(#seg-${gid})`}
              connectNulls
              activeDot={{ r: 5, fill: COR.principal, stroke: "#fff", strokeWidth: 2 }}
            />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </Grafico>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// DMs por dia (barras empilhadas)

export function GraficoDms({ bloco, className }: { bloco: Bloco<PorPeriodo<DiaDms[]>>; className?: string }) {
  const [p, setP] = useState<Periodo>(30);
  const dados = bloco.ok ? bloco.dados[p] : [];
  const tot = dados.reduce((t, d) => ({ e: t.e + d.enviadas, s: t.s + d.seguradas, f: t.f + d.falhas }), { e: 0, s: 0, f: 0 });
  const total = tot.e + tot.s + tot.f;

  const olhar =
    total === 0
      ? "Enviadas, seguradas para revisão e falhas por dia."
      : tot.s + tot.f === 0
        ? `${numero(tot.e)} DMs enviadas em ${p} dias, nenhuma travada.`
        : `${numero(tot.e)} enviadas, ${numero(tot.s)} seguradas e ${numero(tot.f)} com falha. Seguradas esperam você em Palavras-chave.`;

  return (
    <Grafico
      titulo="DMs por dia"
      olhar={olhar}
      className={className}
      acoes={
        <div className="flex flex-wrap items-center gap-3">
          <Legenda itens={[["Enviadas", COR.principal], ["Seguradas", COR.secundaria], ["Falhas", COR.terciaria]]} />
          <Seletor valor={p} onChange={setP} />
        </div>
      }
    >
      {!bloco.ok ? (
        <SemTabela bloco={bloco} />
      ) : total === 0 ? (
        <Vazio titulo="Nenhuma DM no período" texto="As barras aparecem quando alguém comentar a palavra de uma campanha ativa no Instagram." />
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={dados} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="22%">
            <CartesianGrid vertical={false} stroke={COR.grade} />
            <XAxis dataKey="rotulo" tick={EIXO} axisLine={false} tickLine={false} minTickGap={16} />
            <YAxis tick={EIXO} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
            <Tooltip content={<Dica />} cursor={{ fill: "rgba(17,18,23,.04)" }} />
            <Bar dataKey="enviadas" name="Enviadas" stackId="dm" fill={COR.principal} />
            <Bar dataKey="seguradas" name="Seguradas" stackId="dm" fill={COR.secundaria} />
            <Bar dataKey="falhas" name="Falhas" stackId="dm" fill={COR.terciaria} radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Grafico>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Palavras que mais convertem (barras horizontais)

export function GraficoPalavras({ bloco, className }: { bloco: Bloco<PorPeriodo<PalavraConversao[]>>; className?: string }) {
  const [p, setP] = useState<Periodo>(30);
  const dados = bloco.ok ? bloco.dados[p] : [];
  const melhor = [...dados].filter((d) => d.comentarios >= 3 && d.taxa !== null).sort((a, b) => (b.taxa ?? 0) - (a.taxa ?? 0))[0];
  const maisComentada = dados[0];

  const olhar = melhor
    ? `${melhor.palavra} converte ${pct(melhor.taxa ?? 0)} dos comentários em DM. Repita o gancho dela nos próximos Reels.`
    : maisComentada
      ? `${maisComentada.palavra} é a mais comentada. Com 3+ comentários por palavra dá para comparar a conversão.`
      : "Comentários x DMs enviadas por palavra.";

  return (
    <Grafico
      titulo="Palavras que mais convertem"
      olhar={olhar}
      className={className}
      acoes={<Seletor valor={p} onChange={setP} />}
    >
      {!bloco.ok ? (
        <SemTabela bloco={bloco} />
      ) : dados.length === 0 ? (
        <Vazio titulo="Nenhuma palavra comentada" texto="Cada campanha ativa vira uma barra quando receber o primeiro comentário com a palavra." />
      ) : (
        <>
          <ResponsiveContainer width="100%" height={Math.max(200, dados.length * 44 + 30)}>
            <BarChart data={dados} layout="vertical" margin={{ top: 0, right: 12, left: 0, bottom: 0 }} barGap={3} barCategoryGap="26%">
              <CartesianGrid horizontal={false} vertical={false} />
              <XAxis type="number" hide allowDecimals={false} />
              <YAxis type="category" dataKey="palavra" tick={{ ...EIXO, fill: "#111217", fontWeight: 600 }} axisLine={false} tickLine={false} width={92} />
              <Tooltip
                cursor={{ fill: "rgba(17,18,23,.04)" }}
                content={
                  <Dica
                    titulo={(pl, l) => {
                      const t = (pl[0]?.payload as PalavraConversao | undefined)?.taxa;
                      return t === null || t === undefined ? String(l) : `${l} · ${pct(t)} viram DM`;
                    }}
                  />
                }
              />
              <Bar dataKey="comentarios" name="Comentários" fill={COR.terciaria} radius={[0, 6, 6, 0]} />
              <Bar dataKey="enviadas" name="DMs enviadas" fill={COR.principal} radius={[0, 6, 6, 0]} />
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2">
            <Legenda itens={[["Comentários", COR.terciaria], ["DMs enviadas", COR.principal]]} />
          </div>
        </>
      )}
    </Grafico>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Distribuição da audiência (donut)

function ehRede(id: string): id is RedeId {
  return (REDE_IDS as readonly string[]).includes(id);
}

export function GraficoAudiencia({ bloco, className }: { bloco: Bloco<FatiaAudiencia[]>; className?: string }) {
  const dados = bloco.ok ? bloco.dados : [];
  const total = dados.reduce((t, d) => t + d.seguidores, 0);
  const maior = dados[0];
  const olhar = maior
    ? dados.length > 1
      ? `${maior.nome} concentra ${pct(maior.pct)} da audiência. Reaproveite os Reels nas redes menores para equilibrar.`
      : `Toda a audiência está no ${maior.nome}.`
    : "Seguidores por rede conectada.";

  return (
    <Grafico titulo="Distribuição da audiência" olhar={olhar} className={className}>
      {!bloco.ok ? (
        <SemTabela bloco={bloco} />
      ) : dados.length === 0 ? (
        <Vazio titulo="Nenhuma rede com seguidores" texto="Vem do último snapshot de cada rede (coletor das Redes) e da coleta diária do Instagram." />
      ) : (
        <div className="flex flex-col items-center gap-4">
          <div className="relative h-[200px] w-full max-w-[220px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={dados} dataKey="seguidores" nameKey="nome" innerRadius={64} outerRadius={92} paddingAngle={2} stroke="none" cornerRadius={6}>
                  {dados.map((d, i) => (
                    <Cell key={d.rede} fill={FATIAS[i % FATIAS.length]} />
                  ))}
                </Pie>
                <Tooltip content={<Dica />} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
              <div>
                <span className="opi-num block text-2xl leading-none">{numero(total)}</span>
                <span className="text-[11px] uppercase tracking-[.1em] text-muted">seguidores</span>
              </div>
            </div>
          </div>
          <ul className="w-full space-y-1.5 text-sm">
            {dados.map((d, i) => (
              <li key={d.rede} className="flex items-center gap-2">
                <i className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: FATIAS[i % FATIAS.length] }} aria-hidden />
                {ehRede(d.rede) && <RedeIcone rede={d.rede} className="h-4 w-4 shrink-0" />}
                <span className="min-w-0 flex-1 truncate text-foreground">{d.nome}</span>
                <span className="tabular-nums text-muted">{numero(d.seguidores)}</span>
                <b className="w-12 text-right tabular-nums text-foreground">{pct(d.pct)}</b>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Grafico>
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Horário dos comentários (barras por hora)

export function GraficoHorario({ bloco, className }: { bloco: Bloco<PorPeriodo<HoraComentarios[]>>; className?: string }) {
  const [p, setP] = useState<Periodo>(30);
  const dados = bloco.ok ? bloco.dados[p] : [];
  const total = dados.reduce((t, d) => t + d.comentarios, 0);
  const max = Math.max(0, ...dados.map((d) => d.comentarios));
  const picos = dados.filter((d) => d.comentarios > 0 && d.comentarios === max).map((d) => d.hora);
  const fmtH = (h: number) => `${String(h).padStart(2, "0")}h`;

  const olhar =
    picos.length > 0
      ? `Pico às ${picos.slice(0, 3).map(fmtH).join(", ")} (horário de Brasília). Postar 1 a 2 horas antes pega a audiência acordada.`
      : "Comentários recebidos por hora do dia, horário de Brasília.";

  return (
    <Grafico
      titulo="Horário dos comentários"
      olhar={olhar}
      className={className}
      acoes={<Seletor valor={p} onChange={setP} />}
    >
      {!bloco.ok ? (
        <SemTabela bloco={bloco} />
      ) : total === 0 ? (
        <Vazio titulo="Nenhum comentário no período" texto="Cada comentário recebido pelas campanhas do Instagram entra na hora em que chegou." />
      ) : (
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={dados} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barCategoryGap="18%">
            <CartesianGrid vertical={false} stroke={COR.grade} />
            <XAxis dataKey="rotulo" tick={EIXO} axisLine={false} tickLine={false} interval={2} />
            <YAxis tick={EIXO} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
            <Tooltip content={<Dica />} cursor={{ fill: "rgba(17,18,23,.04)" }} />
            <Bar dataKey="comentarios" name="Comentários" radius={[6, 6, 0, 0]}>
              {dados.map((d) => (
                <Cell key={d.hora} fill={picos.includes(d.hora) ? COR.principal : COR.terciaria} />
              ))}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      )}
    </Grafico>
  );
}
