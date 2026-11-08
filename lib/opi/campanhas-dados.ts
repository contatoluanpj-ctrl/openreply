// Gráficos de decisão da página Campanhas (/campaigns). Funções puras de agregação sobre DmLog e Automation:
// a rota app/api/opi/campanhas-stats busca as linhas do workspace e chama `montarStatsCampanhas`.
// Nada aqui inventa número: tudo sai das linhas recebidas. Dias contados em America/Sao_Paulo (UTC-3 fixo).

export const PERIODOS = [7, 30, 90] as const;
export type Periodo = (typeof PERIODOS)[number];

export function periodoValido(v: string | null | undefined): Periodo {
  const n = Number(v);
  return (PERIODOS as readonly number[]).includes(n) ? (n as Periodo) : 30;
}

const OFFSET_SP_MS = 3 * 60 * 60 * 1000;
const DIA_MS = 24 * 60 * 60 * 1000;

/** "AAAA-MM-DD" do dia em São Paulo. */
export function diaSP(d: Date): string {
  return new Date(d.getTime() - OFFSET_SP_MS).toISOString().slice(0, 10);
}

/** Início (00:00 em SP) do primeiro dia da janela de `dias` dias que termina hoje. */
export function inicioJanela(agora: Date, dias: number): Date {
  const hojeSP = diaSP(agora);
  const meiaNoiteHoje = new Date(`${hojeSP}T00:00:00.000Z`).getTime() + OFFSET_SP_MS;
  return new Date(meiaNoiteHoje - (dias - 1) * DIA_MS);
}

/** Lista dos dias da janela, do mais antigo ao de hoje. */
export function diasDaJanela(agora: Date, dias: number): string[] {
  const inicio = inicioJanela(agora, dias).getTime();
  return Array.from({ length: dias }, (_, i) => diaSP(new Date(inicio + i * DIA_MS + 12 * 60 * 60 * 1000)));
}

export type CampanhaLinha = {
  id: string;
  name: string;
  isActive: boolean;
  keywords: string[];
  username?: string | null;
};

export type LogLinha = {
  automationId: string;
  status: string;
  createdAt: Date;
  dmSentAt: Date | null;
  publicReplySentAt: Date | null;
};

export type CampanhaStats = {
  id: string;
  nome: string;
  ativa: boolean;
  palavras: string[];
  username: string | null;
  comentarios: number;
  dms: number;
  seguradas: number;
  taxa: number | null; // % de comentários que viraram DM enviada; null sem comentários
  ultimoEnvio: string | null; // ISO
};

export type StatsCampanhas = {
  periodo: Periodo;
  kpis: {
    ativas: number;
    total: number;
    comentarios: number;
    dms: number;
    taxa: number | null;
    seguradas: number;
  };
  porCampanha: CampanhaStats[];
  porDia: { dia: string; dms: number; comentarios: number }[];
  resposta: {
    ambas: number; // DM enviada e resposta pública entregue
    soDm: number;
    soPublica: number;
    nenhuma: number;
  };
};

export function taxa(parte: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.round((parte / total) * 1000) / 10;
}

/**
 * Agrega os logs da janela. `logs` já deve vir filtrado por workspace e por createdAt >= inicioJanela;
 * `ultimosEnvios` é o último dmSentAt de cada campanha em todo o histórico (fora da janela também).
 */
export function montarStatsCampanhas(entrada: {
  agora: Date;
  periodo: Periodo;
  campanhas: CampanhaLinha[];
  logs: LogLinha[];
  ultimosEnvios?: Record<string, Date | null>;
}): StatsCampanhas {
  const { agora, periodo, campanhas, logs, ultimosEnvios = {} } = entrada;
  const inicio = inicioJanela(agora, periodo).getTime();
  const naJanela = logs.filter((l) => l.createdAt.getTime() >= inicio && l.createdAt.getTime() <= agora.getTime());

  const porId = new Map<string, { comentarios: number; dms: number; seguradas: number }>();
  for (const c of campanhas) porId.set(c.id, { comentarios: 0, dms: 0, seguradas: 0 });

  const dias = diasDaJanela(agora, periodo);
  const porDiaMap = new Map(dias.map((d) => [d, { dia: d, dms: 0, comentarios: 0 }]));
  const resposta = { ambas: 0, soDm: 0, soPublica: 0, nenhuma: 0 };
  let dms = 0;
  let seguradas = 0;

  for (const l of naJanela) {
    const enviada = l.status === "SENT";
    const publica = l.publicReplySentAt !== null;
    const alvo = porId.get(l.automationId);
    if (alvo) {
      alvo.comentarios++;
      if (enviada) alvo.dms++;
      if (l.status === "HELD_FOR_REVIEW") alvo.seguradas++;
    }
    if (enviada) dms++;
    if (l.status === "HELD_FOR_REVIEW") seguradas++;

    const diaC = porDiaMap.get(diaSP(l.createdAt));
    if (diaC) diaC.comentarios++;
    if (enviada) {
      const diaD = porDiaMap.get(diaSP(l.dmSentAt ?? l.createdAt));
      if (diaD) diaD.dms++;
    }

    if (enviada && publica) resposta.ambas++;
    else if (enviada) resposta.soDm++;
    else if (publica) resposta.soPublica++;
    else resposta.nenhuma++;
  }

  const porCampanha: CampanhaStats[] = campanhas
    .map((c) => {
      const s = porId.get(c.id)!;
      const ultimo = ultimosEnvios[c.id];
      return {
        id: c.id,
        nome: c.name,
        ativa: c.isActive,
        palavras: c.keywords,
        username: c.username ?? null,
        comentarios: s.comentarios,
        dms: s.dms,
        seguradas: s.seguradas,
        taxa: taxa(s.dms, s.comentarios),
        ultimoEnvio: ultimo ? ultimo.toISOString() : null,
      };
    })
    .sort((a, b) => b.comentarios - a.comentarios || b.dms - a.dms || a.nome.localeCompare(b.nome));

  return {
    periodo,
    kpis: {
      ativas: campanhas.filter((c) => c.isActive).length,
      total: campanhas.length,
      comentarios: naJanela.length,
      dms,
      taxa: taxa(dms, naJanela.length),
      seguradas,
    },
    porCampanha,
    porDia: dias.map((d) => porDiaMap.get(d)!),
    resposta,
  };
}
