import { formatarBRL, type BarraMes } from "@/lib/opi/financeiro";

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

// Só escala de cinza: receita em cinza claro, despesa em cinza médio.
const COR_RECEITA = "#d4d4d4";
const COR_DESPESA = "#737373";
const COR_GRADE = "#2a2a2a";
const COR_ROTULO = "#a3a3a3";

function rotuloMes(mes: string) {
  const [ano, m] = mes.split("-");
  return `${MESES[Number(m) - 1]}/${ano.slice(2)}`;
}

/** Barras agrupadas por mês, em SVG puro (sem biblioteca). Valores em centavos. */
export function GraficoMensal({ dados }: { dados: BarraMes[] }) {
  const largura = 600;
  const altura = 220;
  const margem = { topo: 12, baixo: 28, esq: 8, dir: 8 };
  const areaH = altura - margem.topo - margem.baixo;
  const areaW = largura - margem.esq - margem.dir;
  const maximo = Math.max(1, ...dados.flatMap((d) => [d.receita, d.despesa]));
  const grupo = dados.length > 0 ? areaW / dados.length : areaW;
  const barra = Math.min(28, grupo / 3);
  const y = (v: number) => margem.topo + areaH - (v / maximo) * areaH;
  const vazio = dados.every((d) => d.receita === 0 && d.despesa === 0);

  return (
    <div>
      <svg
        viewBox={`0 0 ${largura} ${altura}`}
        className="h-auto w-full"
        role="img"
        aria-label="Receita e despesa por mês"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={margem.esq}
            x2={largura - margem.dir}
            y1={y(maximo * f)}
            y2={y(maximo * f)}
            stroke={COR_GRADE}
            strokeWidth={1}
          />
        ))}
        {dados.map((d, i) => {
          const cx = margem.esq + grupo * i + grupo / 2;
          return (
            <g key={d.mes}>
              <rect
                x={cx - barra - 2}
                y={y(d.receita)}
                width={barra}
                height={margem.topo + areaH - y(d.receita)}
                fill={COR_RECEITA}
                rx={2}
              >
                <title>{`${rotuloMes(d.mes)} — receita ${formatarBRL(d.receita)}`}</title>
              </rect>
              <rect
                x={cx + 2}
                y={y(d.despesa)}
                width={barra}
                height={margem.topo + areaH - y(d.despesa)}
                fill={COR_DESPESA}
                rx={2}
              >
                <title>{`${rotuloMes(d.mes)} — despesa ${formatarBRL(d.despesa)}`}</title>
              </rect>
              <text
                x={cx}
                y={altura - 8}
                textAnchor="middle"
                fontSize={12}
                fill={COR_ROTULO}
              >
                {rotuloMes(d.mes)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COR_RECEITA }} />
          Receita
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: COR_DESPESA }} />
          Despesa
        </span>
        {vazio && <span>Sem lançamentos nos últimos 6 meses.</span>}
      </div>
    </div>
  );
}
