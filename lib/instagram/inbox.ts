import {
  MetaApiError,
  PermissionError,
  RateLimitError,
  TokenExpiredError,
  type InstagramConversation,
  type InstagramMessage,
} from "@/lib/meta/client";
import { isFacebookLogin } from "@/lib/meta/login-mode";

/**
 * Caixa de entrada: transforma o que a Graph devolve na forma da tela e traduz os erros.
 *
 * Os dois modos de login chegam aqui com o mesmo formato de dados:
 * - META_LOGIN=facebook: GET graph.facebook.com/{page-id}/conversations?platform=instagram com o token
 *   da Página, e as mensagens em GET /{conversation-id}?fields=messages{...}.
 * - Login do Instagram: GET graph.instagram.com/{ig-user-id}/conversations?platform=instagram.
 * Quem escolhe a URL é lib/meta/client.ts; aqui não há chamada de rede.
 */

export interface ConversationListItem {
  id: string;
  detailsUnavailable?: boolean;
  contact: { id: string; username: string | null };
  updatedTime: string | null;
  lastMessage: {
    text: string;
    fromMe: boolean;
    createdTime: string | null;
  } | null;
}

export interface ThreadMessage {
  id: string;
  text: string;
  fromMe: boolean;
  fromUsername: string | null;
  createdTime: string | null;
}

export type ModoInbox = "facebook" | "instagram" | "zernio";

export function modoInbox(provider: "META" | "ZERNIO"): ModoInbox {
  if (provider === "ZERNIO") return "zernio";
  return isFacebookLogin() ? "facebook" : "instagram";
}

export function montarConversas(raw: InstagramConversation[], instagramId: string): ConversationListItem[] {
  return raw
    .map((c) => {
      const participantes = c.participants?.data ?? [];
      const contato = participantes.find((p) => p.id !== instagramId) ?? null;
      const ultima = c.messages?.data?.[0] ?? null;
      return {
        id: c.id,
        detailsUnavailable: c.detailsUnavailable,
        contact: { id: contato?.id ?? "", username: contato?.username ?? null },
        updatedTime: c.updated_time ?? null,
        lastMessage: ultima
          ? {
              text: ultima.message ?? "",
              fromMe: ultima.from?.id === instagramId,
              createdTime: ultima.created_time ?? null,
            }
          : null,
      };
    })
    .sort((a, b) => (b.updatedTime ?? "").localeCompare(a.updatedTime ?? ""));
}

/** A Graph devolve as mais novas primeiro; a tela lê de cima para baixo. */
export function montarMensagens(raw: InstagramMessage[], instagramId: string): ThreadMessage[] {
  return raw
    .map((m) => ({
      id: m.id,
      text: m.message ?? "",
      fromMe: m.from?.id === instagramId,
      fromUsername: m.from?.username ?? null,
      createdTime: m.created_time ?? null,
    }))
    .reverse();
}

export type CodigoErroInbox =
  | "sem_conta"
  | "token"
  | "token_local"
  | "permissao"
  | "limite"
  | "tempo"
  | "config"
  | "meta"
  | "desconhecido";

export type ErroInbox = { status: number; codigo: CodigoErroInbox; mensagem: string };

export const ERRO_SEM_CONTA: ErroInbox = {
  status: 404,
  codigo: "sem_conta",
  mensagem: "Nenhuma conta do Instagram conectada neste workspace.",
};

function semSegredo(texto: string): string {
  return texto
    .replace(/access_token=[^&\s"]+/gi, "access_token=[oculto]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [oculto]")
    .slice(0, 300);
}

/**
 * Traduz qualquer falha da leitura da caixa de entrada numa mensagem curta em português, sem token.
 * `acao` diz o que falhou ("carregar as conversas", "carregar as mensagens", "enviar a mensagem").
 */
export function erroInbox(err: unknown, acao = "carregar as conversas"): ErroInbox {
  if (err instanceof TokenExpiredError) {
    return {
      status: 401,
      codigo: "token",
      mensagem:
        "O acesso da Meta expirou ou foi revogado. Gere um token novo da Página (ou reconecte a conta) e tente de novo.",
    };
  }
  if (err instanceof RateLimitError) {
    return {
      status: 429,
      codigo: "limite",
      mensagem: "A Meta limitou as chamadas por agora. Espere alguns minutos e tente de novo.",
    };
  }
  if (err instanceof PermissionError) {
    return {
      status: 403,
      codigo: "permissao",
      mensagem:
        "A Meta recusou a leitura das mensagens. Confira as permissões do app (instagram_manage_messages e pages_messaging) e se o acesso às mensagens está ligado no Instagram (Configurações > Mensagens > Ferramentas conectadas).",
    };
  }
  if (err instanceof MetaApiError) {
    return { status: 502, codigo: "meta", mensagem: `A Meta devolveu um erro ao ${acao}: ${semSegredo(err.message)}` };
  }
  const nome = err instanceof Error ? err.name : "";
  const texto = err instanceof Error ? err.message : String(err ?? "");
  if (nome === "TimeoutError" || nome === "AbortError") {
    return { status: 504, codigo: "tempo", mensagem: `A Meta demorou demais para responder ao ${acao}. Tente de novo.` };
  }
  if (/ENCRYPTION_KEY|unable to authenticate data|Unsupported state|bad decrypt|Invalid key length/i.test(texto)) {
    return {
      status: 500,
      codigo: "token_local",
      mensagem:
        "Não foi possível abrir o token salvo da conta (chave de criptografia diferente ou ausente). Reconecte a conta do Instagram.",
    };
  }
  const faltando = /^(META_[A-Z_]+|FACEBOOK_APP_SECRET) environment variable is required$/.exec(texto);
  if (faltando) {
    return {
      status: 500,
      codigo: "config",
      mensagem: `Configuração do Login do Facebook incompleta: falta ${faltando[1]} no servidor.`,
    };
  }
  return { status: 500, codigo: "desconhecido", mensagem: `Não foi possível ${acao}. Tente de novo em instantes.` };
}
