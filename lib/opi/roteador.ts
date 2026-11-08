/**
 * Roteador de pedidos do OPI Central (D-0016 "Jev primeiro").
 *
 * O Luan escreve um pedido em linguagem natural; o Jev escolhe (Choice) qual agente do mapa é o
 * responsável e diz (Noul) se o pedido envolve várias áreas. O Luan confirma ou troca antes de
 * enviar; a escolha final dele volta ao JevLedger (finalLuan) para a calibração semanal.
 *
 * Puro + fetch injetado, para os testes não tocarem rede.
 */
import { createHash } from "node:crypto";
import { AGENTES_IDS, nomeDoAgente } from "@/lib/opi/agentes";
import { TYPESAFE_URL } from "@/lib/opi/jev-gate";

export const PERGUNTA_RESPONSAVEL = { id: "opi.roteador.responsavel", version: 2 } as const;
export const PERGUNTA_VARIAS_AREAS = { id: "opi.roteador.varias_areas", version: 1 } as const;
export const LEDGER_AUTOMACAO = "roteador";

/** Abaixo disso, o pedido vai ao CEO (Chief of Staff), que divide e encaminha. */
export const LIMIAR_CONFIANCA = 0.45;
/** Acima disso, o pedido é um projeto de várias áreas: o CEO coordena junto com o responsável. */
export const LIMIAR_VARIAS_AREAS = 0.6;

/**
 * Quando mandar para cada agente. Textos distintos entre si (o Jev compara as opções).
 * Fonte: company-os/08-agents (registro e hierarquia) e OPI/.claude/agents.
 */
export const ROTAS: Record<string, string> = {
  ceo: "Chief of Staff: prioridades da semana, decisões que cruzam várias áreas, planejamento geral da empresa, registrar decisão (D-00NN), pedidos vagos que precisam ser divididos entre áreas.",
  cmo: "Estratégia de marketing e de conteúdo: linha editorial, calendário de 30 dias, posicionamento da marca, campanhas, metas de seguidores, lançamento de algo para a audiência.",
  compliance: "Conformidade e risco jurídico: perguntas como 'isso pode ir ao ar?', 'posso postar/falar isso?', revisar se um texto, legenda, vídeo, PDF ou DM é permitido (CVM, promessa de ganho, recomendação de investimento, aviso obrigatório, LGPD, privacidade).",
  cfo: "Finanças: gastos, orçamento, lançamentos no financeiro, custo de ferramentas, aprovar ou estimar despesa, fluxo de caixa, preço.",
  cpo: "Produto: o OPI Club, a comunidade como produto (área da comunidade, membros, conteúdo exclusivo), materiais pagos, hipóteses de produto e o que construir para o cliente.",
  cto: "Tecnologia: site da OPI, painel OPI Central, servidores, deploy, integrações e contas técnicas (Meta, Vercel, n8n), bugs de sistema, segurança.",
  chief_ai: "Agentes de IA e Jev: criar ou ajustar agentes, skills, prompts, roteamento, ledger do Jev e qualidade dos modelos.",
  cro: "Receita: lista de espera, captura de leads, funil de vendas, oferta, conversão de seguidores em clientes.",
  research: "Pesquisa: benchmark de concorrentes, levantar dados de mercado, estudar referências antes de decidir algo.",
  cx: "Sucesso do cliente: atendimento de quem já é cliente/membro, reclamações, suporte e satisfação.",
  coo: "Operações: processos internos, rotinas recorrentes, checklists operacionais, organização do dia a dia da empresa.",
  chro: "Pessoas: contratar freelancer ou pessoa, papéis da equipe humana.",
  "editor-de-videos": "Edição de vídeo: cortar, mudar cena, legenda, B-roll, estilo de edição, refazer o final, trocar música ou efeito em um Reel ou vídeo já gravado.",
  "social-distribuicao": "Publicação: agendar ou reagendar posts e Reels, fila de 7 dias, horário de postagem, conferir o que saiu, métricas da semana nas redes.",
  "roteirista-copywriter": "Escrever roteiro de Reel, gancho, legenda de post, CTA da legenda ou reescrever um roteiro.",
  content_strategist: "Pauta: escolher temas e ideias de conteúdo, séries, formatos novos de post.",
  copywriter: "Textos longos fora dos Reels: página do site, e-mail, descrição de material, texto de PDF.",
  social_media: "Contas nas redes: bio, destaques, link da bio, perfil, configurar conta nova (TikTok, YouTube, LinkedIn).",
  video_research: "Referências de vídeo: analisar vídeos de outros criadores, tendências, formatos que funcionam.",
  community_manager: "Comunidade no dia a dia: responder comentários e DMs manuais, moderar, engajar seguidores, grupo da comunidade.",
  options_education_reviewer: "Revisão técnica de opções: conferir se a explicação, as contas e os exemplos sobre call, put, strike, prêmio e gregas estão corretos.",
  data_analyst: "Números: scorecard semanal, dashboard, análise de métricas e relatórios com dados.",
  lead_response_sdr: "Responder leads: quem pediu material ou entrou na lista e precisa de retorno individual.",
  automation_engineer: "Automações: criar ou mudar fluxo automático (n8n, DM automática, comentário→DM, alertas), integrações de custo zero.",
  software_engineer: "Programar: corrigir bug, nova função ou integração no site ou no painel, banco de dados, ferramenta interna.",
  "web-designer": "Visual do site: redesenhar páginas, deixar o site mais bonito e avançado, animações de scroll (scroll trigger, GSAP), design system, layout, tipografia e cores.",
  "gestor-de-trafego": "Anúncios pagos: Meta Ads, Google Ads, YouTube/TikTok Ads, otimizar campanha, orçamento, criativo de anúncio, pixel e conversões.",
  filmmaker: "Gravação: preparar e operar o OBS, cenas de tela e câmera, áudio e enquadramento antes de gravar um vídeo.",
};

export type SugestaoRota = {
  responsavel: string;
  confianca: number;
  variasAreas: number | null;
  /** Top 3 por probabilidade (inclui o responsável). */
  ranking: { id: string; nome: string; p: number }[];
  /** Agentes que recebem o pedido se o Luan confirmar (responsável + CEO quando for o caso). */
  destinos: string[];
  motivo: string;
};

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export function corpoRoteador(mensagem: string) {
  const criteria: Record<string, string> = {};
  for (const id of AGENTES_IDS) if (ROTAS[id]) criteria[id] = `${nomeDoAgente(id)} — ${ROTAS[id]}`;
  return {
    model: "jev-latest",
    state: {
      pedido: mensagem.slice(0, 2000),
      empresa:
        "OPI (Opções para Investidores): Brazilian educational brand about stock options on Instagram (Reels, carousels, free PDFs by DM), with a website, an internal panel and a team of AI agents led by the founder Luan.",
    },
    questions: {
      responsavel: {
        type: "choice",
        instructions:
          "The founder wrote `pedido` to his team. Which team member is primarily responsible for doing this work? Pick the one who would actually execute it, not who approves it.",
        criteria,
      },
      varias_areas: {
        type: "noul",
        instructions:
          "Does `pedido` describe a project that clearly needs several different areas working together (for example strategy, product, technology and content at once), rather than a single task for one specialist?",
      },
    },
  };
}

export function interpretarResposta(corpo: unknown): SugestaoRota | null {
  const ans = (corpo as { answers?: Record<string, unknown> } | null)?.answers;
  const r = ans?.responsavel as { choice?: unknown; confidence?: unknown; probabilities?: Record<string, unknown> } | undefined;
  if (!r || typeof r.choice !== "string" || !AGENTES_IDS.includes(r.choice)) return null;
  const probs = Object.entries(r.probabilities ?? {})
    .filter(([id, p]) => AGENTES_IDS.includes(id) && typeof p === "number" && Number.isFinite(p))
    .map(([id, p]) => ({ id, nome: nomeDoAgente(id), p: p as number }))
    .sort((a, b) => b.p - a.p);
  const confianca = typeof r.confidence === "number" ? r.confidence : probs[0]?.p ?? 0;
  const va = (ans?.varias_areas as { noul?: unknown } | undefined)?.noul;
  const variasAreas = typeof va === "number" && Number.isFinite(va) ? va : null;

  let destinos = [r.choice];
  let motivo = `${nomeDoAgente(r.choice)} (${Math.round((probs[0]?.p ?? 0) * 100)}%)`;
  if (confianca < LIMIAR_CONFIANCA && r.choice !== "ceo") {
    destinos = ["ceo"];
    motivo = `Jev em dúvida (confiança ${confianca.toFixed(2)}): vai ao CEO, que divide e encaminha`;
  } else if (variasAreas !== null && variasAreas >= LIMIAR_VARIAS_AREAS && r.choice !== "ceo") {
    destinos = [r.choice, "ceo"];
    motivo += " · projeto de várias áreas: o CEO coordena junto";
  }
  return { responsavel: r.choice, confianca, variasAreas, ranking: probs.slice(0, 3), destinos, motivo };
}

export async function sugerirRota(
  mensagem: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  timeoutMs = 20_000,
): Promise<SugestaoRota | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(TYPESAFE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(corpoRoteador(mensagem)),
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return interpretarResposta(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

export function hashPedido(mensagem: string): string {
  return createHash("sha256").update(mensagem).digest("hex").slice(0, 16);
}

/** Texto que o agente recebe: o pedido do Luan + de onde veio. */
export function mensagemParaAgente(mensagem: string, destino: string, destinos: string[]): string {
  const outros = destinos.filter((d) => d !== destino).map(nomeDoAgente);
  const extra = outros.length ? `\n\n(Pedido também enviado a: ${outros.join(", ")}. Combine com eles pelo painel.)` : "";
  return `${mensagem}${extra}\n\n— enviado pelo chat central do OPI Central`;
}
