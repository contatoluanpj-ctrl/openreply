/**
 * Catálogo da equipe da OPI (fonte: company-os/08-agents/AGENT_REGISTRY.md e OPI/.claude/agents/).
 * Sem banco: pode ser importado em componentes de cliente.
 */

export type StatusRegistro = "ACTIVE" | "ON-DEMAND" | "FUTURE" | "NOT_JUSTIFIED_YET";

export interface MembroEquipe {
  id: string;
  nome: string;
  papel: string;
  status?: StatusRegistro;
  reportaA?: string;
  /** Tem chat no OPI Central (subagente real chamável pelo runner). */
  chat?: boolean;
}

export const FUNDADOR: MembroEquipe = { id: "luan", nome: "Luan", papel: "Fundador" };

/** Todos os C-levels ficam no mesmo nível do mapa, logo abaixo do fundador. */
export const C_LEVELS: readonly MembroEquipe[] = [
  { id: "ceo", nome: "CEO", papel: "AI Chief of Staff", status: "ACTIVE" },
  { id: "cmo", nome: "CMO", papel: "Marketing e conteúdo", status: "ACTIVE" },
  { id: "compliance", nome: "Compliance", papel: "Jurídico e risco (independente)", status: "ACTIVE" },
  { id: "cfo", nome: "CFO", papel: "Finanças e gastos", status: "ON-DEMAND" },
  { id: "cpo", nome: "CPO", papel: "Produto (OPI Club)", status: "ON-DEMAND" },
  { id: "cto", nome: "CTO", papel: "Tecnologia e site", status: "ON-DEMAND" },
  { id: "chief_ai", nome: "CIO", papel: "Chief AI Officer", status: "ON-DEMAND" },
  { id: "cro", nome: "CRO", papel: "Receita e lista de espera", status: "ON-DEMAND" },
  { id: "research", nome: "Research", papel: "Pesquisa e benchmark", status: "ON-DEMAND" },
  { id: "cx", nome: "CX", papel: "Sucesso do cliente", status: "FUTURE" },
  { id: "coo", nome: "COO", papel: "Operações", status: "FUTURE" },
  { id: "chro", nome: "CHRO", papel: "Pessoas", status: "NOT_JUSTIFIED_YET" },
];

/** Nomes = nomes dos arquivos em OPI/.claude/agents/ (o runner passa isso ao "claude -p"). */
export const AGENTES_CHAT = ["editor-de-videos", "social-distribuicao", "roteirista-copywriter"] as const;
export type AgenteChat = (typeof AGENTES_CHAT)[number];

export const OPERACIONAIS: readonly MembroEquipe[] = [
  { id: "editor-de-videos", nome: "Editor de vídeos", papel: "Edita os Reels (corte, legenda)", status: "ACTIVE", reportaA: "cmo", chat: true },
  { id: "social-distribuicao", nome: "Social/Distribuição", papel: "Fila de 7 dias e métricas", status: "ACTIVE", reportaA: "cmo", chat: true },
  { id: "roteirista-copywriter", nome: "Roteirista/Copywriter", papel: "Roteiros e legendas", status: "ACTIVE", reportaA: "cmo", chat: true },
  { id: "content_strategist", nome: "Content Strategist", papel: "Pauta e estratégia", status: "ACTIVE", reportaA: "cmo" },
  { id: "copywriter", nome: "Copywriter", papel: "Texto (Lumio writer)", status: "ACTIVE", reportaA: "cmo" },
  { id: "social_media", nome: "Social Media", papel: "Contas nas redes", status: "ON-DEMAND", reportaA: "cmo" },
  { id: "video_research", nome: "Video Research", papel: "Benchmark de vídeo", status: "ON-DEMAND", reportaA: "cmo" },
  { id: "community_manager", nome: "Community Manager", papel: "Comunidade", status: "ON-DEMAND", reportaA: "cmo" },
  { id: "options_education_reviewer", nome: "Options Education Reviewer", papel: "Revisão técnica e de conformidade", status: "ACTIVE", reportaA: "compliance" },
  { id: "data_analyst", nome: "Data & Scorecard Analyst", papel: "Scorecard semanal", status: "ACTIVE", reportaA: "ceo" },
  { id: "lead_response_sdr", nome: "Lead Response (SDR)", papel: "Resposta a leads", status: "ON-DEMAND", reportaA: "cro" },
  { id: "automation_engineer", nome: "Automation Engineer", papel: "Automações de custo zero", status: "ON-DEMAND", reportaA: "cto" },
  { id: "software_engineer", nome: "Software Engineer", papel: "Site e ferramentas", status: "ON-DEMAND", reportaA: "cto" },
];

export const STATUS_LABEL: Record<StatusRegistro, string> = {
  ACTIVE: "Ativo no registro",
  "ON-DEMAND": "Sob demanda",
  FUTURE: "Futuro",
  NOT_JUSTIFIED_YET: "Ainda não justificado",
};

export const ATIVIDADE_RECENTE_MS = 15 * 60 * 1000;

export interface PedidoResumo {
  status: string;
  updatedAt: Date | string;
}

/** Ativo = algum pedido EM_ANDAMENTO ou qualquer atividade nos últimos 15 minutos. */
export function estaAtivo(pedidos: readonly PedidoResumo[], agora: Date = new Date()): boolean {
  return pedidos.some(
    (p) =>
      p.status === "EM_ANDAMENTO" ||
      agora.getTime() - new Date(p.updatedAt).getTime() < ATIVIDADE_RECENTE_MS,
  );
}

export function isAgenteChat(value: unknown): value is AgenteChat {
  return typeof value === "string" && (AGENTES_CHAT as readonly string[]).includes(value);
}

export function nomeDoAgente(id: string): string {
  return OPERACIONAIS.find((m) => m.id === id)?.nome ?? id;
}
