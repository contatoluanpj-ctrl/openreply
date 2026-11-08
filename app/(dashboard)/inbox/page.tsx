"use client";

/**
 * Caixa de entrada
 *
 * Conversas de DM do Instagram da conta escolhida, com histórico e campo de resposta. Funciona com o
 * Login do Facebook (META_LOGIN=facebook, token da Página em graph.facebook.com) e com o Login do
 * Instagram; quem escolhe o caminho é o servidor. A Meta só detalha as 20 mensagens mais recentes de
 * cada conversa, e responder depende da janela de 24 horas do Instagram (o erro da Meta aparece aqui).
 */

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import AccountSelect, { type AccountOption } from "@/components/account-select";
import { PageHeader } from "@/components/opi";
import { readCache, writeCache } from "@/lib/client-cache";
import type { ConversationListItem, ThreadMessage } from "@/lib/instagram/inbox";

const POLL_MS = 12_000;
// A lista e as conversas já vistas aparecem na hora ao voltar; depois atualizam em segundo plano.
const CACHE_MAX_AGE_MS = 60_000;
const convCacheKey = (accountId: string) => `inbox:convs:${accountId}`;
const msgCacheKey = (conversationId: string) => `inbox:msgs:${conversationId}`;

type Resposta<T> = { success: true; data: T } | { success: false; error?: string; codigo?: string };
type EstadoContas = "carregando" | "ok" | "erro";
type ErroTela = { mensagem: string; codigo?: string } | null;

const fmtHora = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const fmtDia = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "short" });
const fmtDiaChave = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });

function formatarQuando(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return fmtDiaChave.format(d) === fmtDiaChave.format(new Date()) ? fmtHora.format(d) : fmtDia.format(d);
}

async function lerJson<T>(res: Response): Promise<Resposta<T>> {
  try {
    return (await res.json()) as Resposta<T>;
  } catch {
    return { success: false, error: `O servidor respondeu ${res.status} sem dados.` };
  }
}

export default function InboxPage() {
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [estadoContas, setEstadoContas] = useState<EstadoContas>("carregando");
  const [selectedAccountId, setSelectedAccountId] = useState("");

  const [conversations, setConversations] = useState<ConversationListItem[]>([]);
  const [convLoading, setConvLoading] = useState(false);
  const [convError, setConvError] = useState<ErroTela>(null);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [threadError, setThreadError] = useState<string | null>(null);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const conversationRequests = useRef(new Set<string>());

  const active = conversations.find((c) => c.id === activeId) ?? null;
  const contaAtual = accounts.find((a) => a.id === selectedAccountId) ?? null;

  const carregarContas = useCallback(async () => {
    setEstadoContas("carregando");
    try {
      const res = await fetch("/api/instagram/accounts", { cache: "no-store" });
      const payload = await lerJson<{
        instagramAccounts: AccountOption[];
        selectedInstagramAccountId: string | null;
      }>(res);
      if (!payload.success) throw new Error(payload.error ?? "Não foi possível carregar as contas.");
      const lista = payload.data.instagramAccounts ?? [];
      setAccounts(lista);
      const lembrada = typeof window !== "undefined" ? window.sessionStorage.getItem("inbox:selectedAccount") : null;
      const valida = lembrada && lista.some((a) => a.id === lembrada) ? lembrada : null;
      setSelectedAccountId(valida ?? payload.data.selectedInstagramAccountId ?? lista[0]?.id ?? "");
      setEstadoContas("ok");
    } catch {
      setAccounts([]);
      setEstadoContas("erro");
    }
  }, []);

  useEffect(() => {
    // Busca inicial das contas (o estado muda só depois do fetch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void carregarContas();
  }, [carregarContas]);

  // Lembra a conta escolhida para a próxima visita.
  useEffect(() => {
    if (typeof window === "undefined" || !selectedAccountId) return;
    window.sessionStorage.setItem("inbox:selectedAccount", selectedAccountId);
  }, [selectedAccountId]);

  const loadConversations = useCallback(
    async (silent: boolean) => {
      if (!selectedAccountId || conversationRequests.current.has(selectedAccountId)) return;
      conversationRequests.current.add(selectedAccountId);
      if (!silent) setConvLoading(true);
      try {
        const res = await fetch(`/api/instagram/conversations?instagramAccountId=${selectedAccountId}`, {
          cache: "no-store",
        });
        const data = await lerJson<{ conversations: ConversationListItem[] }>(res);
        if (data.success) {
          setConversations(data.data.conversations);
          writeCache(convCacheKey(selectedAccountId), data.data.conversations);
          setConvError(null);
        } else if (!silent) {
          setConvError({ mensagem: data.error ?? "Não foi possível carregar as conversas.", codigo: data.codigo });
        }
      } catch {
        if (!silent) setConvError({ mensagem: "Sem conexão com o servidor. Confira a internet e tente de novo." });
      } finally {
        conversationRequests.current.delete(selectedAccountId);
        if (!silent) setConvLoading(false);
      }
    },
    [selectedAccountId]
  );

  // Carrega e atualiza a lista a cada 12 s. A cópia guardada aparece na hora; a nova chega em silêncio.
  useEffect(() => {
    if (!selectedAccountId) return;
    // Troca de conta: zera a conversa aberta (reset intencional na mudança de dependência).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setActiveId(null);
    setMessages([]);
    setConvError(null);
    const cached = readCache<ConversationListItem[]>(convCacheKey(selectedAccountId), CACHE_MAX_AGE_MS);
    if (cached.data) {
      setConversations(cached.data);
      setConvLoading(false);
    } else {
      setConversations([]);
      setConvLoading(true);
    }
    void loadConversations(Boolean(cached.data));
    const timer = window.setInterval(() => void loadConversations(true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [selectedAccountId, loadConversations]);

  const loadMessages = useCallback(
    async (conversationId: string, silent: boolean) => {
      if (!selectedAccountId) return;
      if (!silent) setThreadLoading(true);
      try {
        const res = await fetch(
          `/api/instagram/conversations/${encodeURIComponent(conversationId)}?instagramAccountId=${selectedAccountId}`,
          { cache: "no-store" }
        );
        const data = await lerJson<{ messages: ThreadMessage[] }>(res);
        if (data.success) {
          setMessages(data.data.messages);
          writeCache(msgCacheKey(conversationId), data.data.messages);
          setThreadError(null);
        } else if (!silent) {
          setThreadError(data.error ?? "Não foi possível carregar as mensagens.");
        }
      } catch {
        if (!silent) setThreadError("Sem conexão com o servidor. Confira a internet e tente de novo.");
      } finally {
        if (!silent) setThreadLoading(false);
      }
    },
    [selectedAccountId]
  );

  // Carrega e atualiza a conversa aberta.
  useEffect(() => {
    if (!activeId || active?.detailsUnavailable) return;
    const cached = readCache<ThreadMessage[]>(msgCacheKey(activeId), CACHE_MAX_AGE_MS);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadMessages(activeId, Boolean(cached.data));
    const timer = window.setInterval(() => void loadMessages(activeId, true), POLL_MS);
    return () => window.clearInterval(timer);
  }, [activeId, active?.detailsUnavailable, loadMessages]);

  // Mantém a conversa na mensagem mais recente.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function openConversation(id: string) {
    setActiveId(id);
    setSendError(null);
    setThreadError(null);
    const cached = readCache<ThreadMessage[]>(msgCacheKey(id), CACHE_MAX_AGE_MS);
    setMessages(cached.data ?? []);
    setThreadLoading(!cached.data);
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || !active?.contact.id || sending) return;
    setSending(true);
    setSendError(null);

    const otimista: ThreadMessage = {
      // eslint-disable-next-line react-hooks/purity
      id: `otimista-${Date.now()}`,
      text,
      fromMe: true,
      fromUsername: null,
      createdTime: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, otimista]);
    setDraft("");

    try {
      const res = await fetch("/api/instagram/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ instagramAccountId: selectedAccountId, recipientId: active.contact.id, text }),
      });
      const data = await lerJson<unknown>(res);
      if (data.success) {
        await loadMessages(active.id, true);
        void loadConversations(true);
      } else {
        setMessages((prev) => prev.filter((m) => m.id !== otimista.id));
        setDraft(text);
        setSendError(data.error ?? "Não foi possível enviar a mensagem.");
      }
    } catch {
      setMessages((prev) => prev.filter((m) => m.id !== otimista.id));
      setDraft(text);
      setSendError("Sem conexão com o servidor. A mensagem não foi enviada.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  const nomeContato = (c: ConversationListItem) =>
    c.detailsUnavailable ? "Detalhes indisponíveis" : c.contact.username ? `@${c.contact.username}` : "Contato do Instagram";

  function listaConversas() {
    if (estadoContas === "carregando" || (convLoading && conversations.length === 0)) {
      return (
        <div className="space-y-2 p-4" aria-busy="true" aria-label="Carregando conversas">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="h-12 animate-pulse rounded-2xl bg-[#111217]/5" />
          ))}
        </div>
      );
    }
    if (convError) {
      return (
        <div role="alert" className="space-y-3 px-4 py-6 text-sm">
          <p className="font-semibold text-error">Não deu para abrir a caixa de entrada</p>
          <p className="text-muted">{convError.mensagem}</p>
          <button
            type="button"
            onClick={() => void loadConversations(false)}
            className="rounded-full border border-border bg-white/50 px-3 py-1 text-sm text-foreground hover:bg-surface-hover"
          >
            Tentar de novo
          </button>
        </div>
      );
    }
    if (conversations.length === 0) {
      return (
        <p className="px-4 py-6 text-sm text-muted">
          Nenhuma conversa ainda. Quando alguém mandar DM para {contaAtual ? `@${contaAtual.username}` : "a conta"}, ela aparece
          aqui.
        </p>
      );
    }
    return conversations.map((c) => {
      const isActive = c.id === activeId;
      return (
        <button
          key={c.id}
          type="button"
          onClick={() => openConversation(c.id)}
          className={`block w-full border-b border-border px-4 py-3 text-left ${isActive ? "bg-surface-hover" : "hover:bg-surface-hover"}`}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="truncate text-sm font-semibold text-foreground">{nomeContato(c)}</span>
            <span className="shrink-0 text-[11px] text-muted">{formatarQuando(c.updatedTime)}</span>
          </div>
          {c.detailsUnavailable && (
            <p className="mt-0.5 text-xs text-muted">O Instagram não entregou esta conversa.</p>
          )}
          {c.lastMessage && (
            <p className="mt-0.5 truncate text-xs text-muted">
              {c.lastMessage.fromMe ? "Você: " : ""}
              {c.lastMessage.text || "(sem texto: mídia ou figurinha)"}
            </p>
          )}
        </button>
      );
    });
  }

  // Sem conta (ou falha ao ler as contas): explica o que fazer em vez de "Carregando…" para sempre.
  if (estadoContas === "erro" || (estadoContas === "ok" && accounts.length === 0)) {
    return (
      <div>
        <PageHeader title="Caixa de entrada" description="DMs do Instagram da OPI, com resposta direto daqui." />
        <section className="opi-glass p-6 text-sm">
          {estadoContas === "erro" ? (
            <div role="alert" className="space-y-3">
              <p className="font-semibold text-error">Não foi possível carregar as contas do Instagram.</p>
              <p className="text-muted">Pode ser a sessão que expirou ou o servidor fora do ar por um instante.</p>
              <button
                type="button"
                onClick={() => void carregarContas()}
                className="rounded-full border border-border bg-white/50 px-3 py-1 text-sm text-foreground hover:bg-surface-hover"
              >
                Tentar de novo
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="font-semibold text-foreground">Nenhuma conta do Instagram conectada neste workspace.</p>
              <p className="text-muted">
                Conecte a conta em{" "}
                <Link href="/settings" className="font-semibold text-accent hover:underline">
                  Configurações
                </Link>{" "}
                para ver e responder as DMs aqui.
              </p>
            </div>
          )}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Caixa de entrada"
        description="DMs do Instagram da OPI, com resposta direto daqui. Responder só funciona dentro de 24 h da última mensagem da pessoa."
        actions={
          accounts.length > 1 ? (
            <AccountSelect
              accounts={accounts}
              value={selectedAccountId}
              onChange={setSelectedAccountId}
              includeAll={false}
            />
          ) : undefined
        }
      />

      <div className="opi-glass grid h-[calc(100dvh-15rem)] min-h-[420px] grid-cols-1 overflow-hidden !p-0 sm:grid-cols-[300px_1fr]">
        {/* Lista de conversas: no celular ocupa a tela e some quando abre uma conversa. */}
        <div className={`min-h-0 flex-col border-b border-border sm:flex sm:border-b-0 sm:border-r ${active ? "hidden" : "flex"}`}>
          <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
            <span className="text-sm font-semibold text-foreground">Conversas</span>
            {contaAtual && <span className="truncate text-xs text-muted">@{contaAtual.username}</span>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">{listaConversas()}</div>
        </div>

        {/* Conversa aberta. */}
        <div className={`min-h-0 flex-col ${active ? "flex" : "hidden sm:flex"}`}>
          {!active ? (
            <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted">
              Escolha uma conversa para ler e responder.
            </div>
          ) : (
            <>
              <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold text-foreground">
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className="-ml-1 rounded-full px-2 py-1 text-muted hover:text-foreground sm:hidden"
                  aria-label="Voltar para as conversas"
                >
                  ‹ Voltar
                </button>
                <span className="truncate">{nomeContato(active)}</span>
              </div>

              <div ref={scrollRef} className="min-h-0 flex-1 space-y-2 overflow-y-auto p-4">
                {active.detailsUnavailable ? (
                  <p role="status" className="text-sm text-muted">
                    O Instagram não entregou os detalhes desta conversa. As outras continuam disponíveis; esta dá para ver
                    no app do Instagram.
                  </p>
                ) : threadError && messages.length === 0 ? (
                  <div role="alert" className="space-y-2 text-sm">
                    <p className="text-error">{threadError}</p>
                    <button
                      type="button"
                      onClick={() => void loadMessages(active.id, false)}
                      className="rounded-full border border-border bg-white/50 px-3 py-1 text-sm text-foreground hover:bg-surface-hover"
                    >
                      Tentar de novo
                    </button>
                  </div>
                ) : threadLoading && messages.length === 0 ? (
                  <p className="text-sm text-muted">Carregando mensagens…</p>
                ) : messages.length === 0 ? (
                  <p className="text-sm text-muted">Nenhuma mensagem com texto nesta conversa.</p>
                ) : (
                  messages.map((m) => (
                    <div key={m.id} className={`flex ${m.fromMe ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
                          m.fromMe ? "bg-accent text-white" : "border border-border bg-white/70 text-foreground"
                        }`}
                      >
                        <p className="whitespace-pre-wrap break-words">{m.text || "(mídia sem texto)"}</p>
                        <p className={`mt-1 text-[10px] ${m.fromMe ? "text-white/75" : "text-muted"}`}>
                          {formatarQuando(m.createdTime)}
                        </p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="shrink-0 border-t border-border p-3">
                {sendError && <p className="mb-2 text-xs text-error">{sendError}</p>}
                <div className="flex items-end gap-2">
                  <textarea
                    disabled={active.detailsUnavailable || !active.contact.id}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    placeholder="Escreva a resposta… (Enter envia, Shift+Enter quebra a linha)"
                    className="max-h-32 min-h-[40px] flex-1 resize-none rounded-2xl border border-border bg-white/60 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-accent/40 focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={sending || !draft.trim() || !active.contact.id || active.detailsUnavailable}
                    className="rounded-full bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
                  >
                    {sending ? "Enviando…" : "Enviar"}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
