/**
 * Departamentos do OPI Central e o menu por departamento (etapa 2).
 * Sem banco e sem React: usável no menu (cliente), na página do departamento e nos testes.
 *
 * Diretor e equipe saem do catálogo (lib/opi/agentes.ts, espelho do AGENT_REGISTRY). Onde o registro
 * não tem um dono óbvio, a escolha está comentada aqui para o Luan corrigir.
 */
import { C_LEVELS, OPERACIONAIS, membroPorId, type MembroEquipe } from "./agentes";

export interface ItemMenu {
  label: string;
  href: string;
  /** Só marca ativo no caminho exato (ex.: /dashboard, que é prefixo de quase tudo). */
  exact?: boolean;
}

export interface Ferramenta extends ItemMenu {
  /** Uma linha dizendo para que serve a tela. */
  descricao: string;
}

export interface Departamento {
  slug: string;
  nome: string;
  resumo: string;
  /** Id do diretor no catálogo de agentes. */
  diretorId: string;
  /** Outros diretores que também atuam aqui (aparecem como apoio, não como equipe). */
  apoioIds?: readonly string[];
  /** Equipe fixa. Sem este campo, a equipe é quem reporta ao diretor no catálogo. */
  equipeIds?: readonly string[];
  /** Telas que moram neste departamento (cada rota tem um único departamento dono). */
  ferramentas: readonly Ferramenta[];
  /** Atalhos para telas de outro departamento. Aparecem no menu e na página, mas não mudam o dono da rota. */
  atalhos?: readonly Ferramenta[];
  /** Telas pedidas que ainda não existem. Só o nome: sem link e sem número. */
  planejadas?: readonly string[];
}

const T = {
  dashboard: { label: "Dashboard", href: "/dashboard", exact: true, descricao: "Seguidores, DMs, posts e gasto em uma tela, com os gráficos para decidir." },
  redes: { label: "Redes", href: "/dashboard/redes", descricao: "Números de cada rede e o último post." },
  calendario: { label: "Calendário", href: "/dashboard/calendario", descricao: "Posts agendados, destinos por rede e aprovação." },
  conteudo: { label: "Conteúdo", href: "/dashboard/conteudo", descricao: "Desempenho de cada Reel publicado." },
  palavras: { label: "Palavras-chave", href: "/dashboard/palavras", descricao: "Palavras que disparam DM e comentários sem DM." },
  campanhas: { label: "Campanhas", href: "/campaigns", descricao: "Campanhas de comentário para DM." },
  seguidores: { label: "Seguidores", href: "/overview", descricao: "Seguidores ao longo do tempo e alcance dos posts." },
  leads: { label: "Leads e funil", href: "/dashboard/leads", descricao: "Funil em números: comentários, DMs e contatos." },
  inbox: { label: "Caixa de entrada", href: "/inbox", descricao: "Conversas do Instagram." },
  logs: { label: "Registro de DMs", href: "/logs", descricao: "Cada DM enviada, segurada ou com falha." },
  financeiro: { label: "Financeiro", href: "/dashboard/financeiro", descricao: "Lançamentos, previsto x pago e saldo." },
  diagnostico: { label: "Diagnóstico", href: "/diagnostics", descricao: "Saúde do envio de DMs, do token e do sistema." },
  configuracoes: { label: "Configurações", href: "/settings", descricao: "Conta do Instagram, convites e preferências." },
  integracoes: { label: "Integrações", href: "/integrations", descricao: "Chaves de serviço para agentes e automações." },
  agentes: { label: "Agentes", href: "/dashboard/agentes", descricao: "A equipe em cartões; clique para mandar um pedido." },
} as const satisfies Record<string, Ferramenta>;

/** Na ordem que o Luan passou (14/11/2026). */
export const DEPARTAMENTOS: readonly Departamento[] = [
  {
    slug: "comercial",
    nome: "Comercial",
    resumo: "Leads, funil e o que vira receita.",
    diretorId: "cro",
    ferramentas: [T.leads],
    planejadas: ["Produtos e anúncios"],
  },
  {
    slug: "marketing",
    nome: "Marketing",
    resumo: "Conteúdo, redes e campanhas de DM.",
    diretorId: "cmo",
    ferramentas: [T.redes, T.calendario, T.conteudo, T.palavras, T.campanhas, T.seguidores],
    planejadas: ["Ideias"],
  },
  {
    slug: "operacoes",
    nome: "Operações",
    resumo: "Rotina e processos da OPI.",
    diretorId: "coo",
    ferramentas: [],
  },
  {
    slug: "financeiro",
    nome: "Financeiro",
    resumo: "Caixa, gastos e previsão.",
    diretorId: "cfo",
    ferramentas: [T.financeiro],
  },
  {
    slug: "dados",
    nome: "Dados",
    resumo: "Os painéis de números da OPI em um lugar.",
    // No registro, o Data & Scorecard Analyst reporta ao CEO; não existe um diretor só de dados.
    diretorId: "ceo",
    ferramentas: [],
    atalhos: [T.dashboard, T.conteudo, T.seguidores, T.leads, T.redes],
  },
  {
    slug: "produto",
    nome: "Produto",
    resumo: "Oferta, materiais e o que a OPI vende.",
    diretorId: "cpo",
    ferramentas: [],
  },
  {
    slug: "atendimentos",
    nome: "Atendimentos",
    resumo: "Conversas com quem chega pelas redes.",
    diretorId: "cx",
    ferramentas: [T.inbox, T.logs],
  },
  {
    slug: "rh-e-pessoas",
    nome: "RH e Pessoas",
    resumo: "Quem faz o quê na equipe.",
    diretorId: "chro",
    ferramentas: [],
    atalhos: [T.agentes],
  },
  {
    slug: "juridico",
    nome: "Jurídico",
    resumo: "Conformidade e risco de tudo o que é publicado.",
    diretorId: "compliance",
    ferramentas: [],
  },
  {
    slug: "tecnologia",
    nome: "Tecnologia",
    resumo: "Painel, site, automações e integrações.",
    diretorId: "cto",
    // O CIO cuida do registro e da qualidade dos agentes; no registro ele não reporta ao CTO.
    apoioIds: ["chief_ai"],
    ferramentas: [T.diagnostico, T.configuracoes, T.integracoes],
  },
  {
    slug: "seguranca",
    nome: "Segurança",
    resumo: "Segredos, acessos e privacidade.",
    // SECURITY_AND_PRIVACY.md tem o CTO como dono e a Compliance na parte de LGPD. Sem equipe própria.
    diretorId: "cto",
    apoioIds: ["compliance"],
    equipeIds: [],
    ferramentas: [],
  },
  {
    slug: "pesquisa",
    nome: "Pesquisa",
    resumo: "Benchmark, concorrentes e mercado.",
    diretorId: "research",
    ferramentas: [],
  },
];

export const MENU_HOJE: ItemMenu = { label: "Hoje", href: "/dashboard", exact: true };

export const MENU_SISTEMA: readonly ItemMenu[] = [
  { label: "Agentes", href: T.agentes.href },
  { label: "Chat central", href: "/dashboard/chat" },
];

export const BASE_DEPARTAMENTO = "/dashboard/departamento";

export function hrefDepartamento(slug: string): string {
  return `${BASE_DEPARTAMENTO}/${slug}`;
}

export function departamentoPorSlug(slug: string): Departamento | undefined {
  return DEPARTAMENTOS.find((d) => d.slug === slug);
}

export function itemAtivo(item: ItemMenu, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

/** Itens do submenu do departamento: as telas dele e, depois, os atalhos. */
export function itensDoDepartamento(dep: Departamento): readonly Ferramenta[] {
  return [...dep.ferramentas, ...(dep.atalhos ?? [])];
}

/**
 * Departamento dono da rota: a página do próprio departamento ou a tela que mora nele.
 * Atalho não conta (a tela continua sendo do departamento de origem). Sem dono = null.
 */
export function departamentoDaRota(pathname: string): Departamento | null {
  const caminho = pathname.split(/[?#]/)[0];
  for (const d of DEPARTAMENTOS) {
    if (itemAtivo({ label: d.nome, href: hrefDepartamento(d.slug) }, caminho)) return d;
  }
  // Rota mais específica ganha (ex.: /dashboard/leads antes de um prefixo menor).
  let melhor: { dep: Departamento; tamanho: number } | null = null;
  for (const d of DEPARTAMENTOS) {
    for (const f of d.ferramentas) {
      if (itemAtivo(f, caminho) && (!melhor || f.href.length > melhor.tamanho)) {
        melhor = { dep: d, tamanho: f.href.length };
      }
    }
  }
  return melhor?.dep ?? null;
}

export interface PessoasDoDepartamento {
  diretor: MembroEquipe | undefined;
  equipe: MembroEquipe[];
  apoio: MembroEquipe[];
}

/** Diretor, equipe e apoio do departamento, sempre a partir do catálogo de agentes. */
export function pessoasDoDepartamento(dep: Departamento): PessoasDoDepartamento {
  const diretor = C_LEVELS.find((c) => c.id === dep.diretorId);
  const equipe = dep.equipeIds
    ? dep.equipeIds.map((id) => membroPorId(id)).filter((m): m is MembroEquipe => Boolean(m))
    : OPERACIONAIS.filter((o) => o.reportaA === dep.diretorId);
  const apoio = (dep.apoioIds ?? []).map((id) => membroPorId(id)).filter((m): m is MembroEquipe => Boolean(m));
  return { diretor, equipe, apoio };
}

/** Ids de agente cujos pedidos contam para o departamento (diretor + equipe). */
export function agentesDoDepartamento(dep: Departamento): string[] {
  const { diretor, equipe } = pessoasDoDepartamento(dep);
  return [...(diretor ? [diretor.id] : []), ...equipe.map((m) => m.id)];
}

export interface ItemPendencia {
  texto: string;
  href: string;
  nivel: "erro" | "normal";
}

/** Das pendências gerais, ficam as que se resolvem numa tela deste departamento. */
export function pendenciasDoDepartamento<T extends ItemPendencia>(dep: Departamento, itens: readonly T[]): T[] {
  return itens.filter((i) => departamentoDaRota(i.href)?.slug === dep.slug);
}
