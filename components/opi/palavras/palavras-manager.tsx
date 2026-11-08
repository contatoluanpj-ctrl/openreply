"use client";

import { confirmar } from "@/lib/opi/confirmar";
import { useCallback, useEffect, useState } from "react";
import { Badge, Card } from "@/components/opi";
import type { BadgeTone } from "@/components/opi";
import { AVISO_COMPLIANCE, AVISO_OBRIGATORIO, RESPOSTA_PUBLICA_PADRAO } from "@/lib/opi/palavras-constantes";

type Motivo = "ativa" | "aguardando_revisao" | "pausada";

type Campanha = {
  id: string;
  name: string;
  isActive: boolean;
  postUrl: string | null;
  temPost: boolean;
  motivo: Motivo;
};

type Texto = {
  id: string;
  palavra: string;
  dmMessage: string;
  respostaPublica: string;
  aprovadoPor: string;
  ativo: boolean;
  updatedAt: string;
  campanhas: Campanha[];
};

type SemDm = {
  id: string;
  status: string;
  commenterName: string | null;
  commentText: string;
  matchedKeyword: string | null;
  errorMessage: string | null;
  jevReason: string | null;
  createdAt: string;
  automation: { id: string; name: string };
};

const MOTIVO: Record<Motivo, { tone: BadgeTone; label: string }> = {
  ativa: { tone: "success", label: "ativa" },
  pausada: { tone: "error", label: "pausada" },
  aguardando_revisao: { tone: "neutral", label: "aguardando sua revisão" },
};

const STATUS_LABEL: Record<string, string> = {
  HELD_FOR_REVIEW: "segurada para revisão",
  FAILED: "falhou",
  SKIPPED_DEDUP: "pulada (repetida)",
  SKIPPED_RATE_LIMIT: "pulada (limite do Instagram)",
  SKIPPED_PLAN_LIMIT: "pulada (limite do plano)",
  SKIPPED_NO_MATCH: "pulada (sem casamento)",
};

const BTN = "rounded-md px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-50";
const BTN_PRIMARIO = `${BTN} bg-accent text-accent-foreground hover:bg-accent-hover`;
const BTN_SECUNDARIO = `${BTN} border border-border bg-surface text-foreground hover:bg-surface-hover`;
const BTN_PERIGO = `${BTN} border border-error/40 text-error hover:bg-error/10`;
const CAMPO =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:border-border-hover focus:outline-none";

async function chamar(url: string, init?: RequestInit): Promise<{ ok: boolean; erro?: string; json?: unknown }> {
  try {
    const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
    const json = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, erro: (json as { error?: string }).error ?? `Erro ${r.status}` };
    return { ok: true, json };
  } catch {
    return { ok: false, erro: "Sem conexão com o servidor" };
  }
}

type Rascunho = { palavra: string; dmMessage: string; respostaPublica: string; ativo: boolean };
const VAZIO: Rascunho = { palavra: "", dmMessage: "", respostaPublica: RESPOSTA_PUBLICA_PADRAO, ativo: true };

function FormTexto({
  inicial,
  titulo,
  onSalvar,
  onCancelar,
}: {
  inicial: Rascunho;
  titulo: string;
  onSalvar: (r: Rascunho) => Promise<string | null>;
  onCancelar?: () => void;
}) {
  const [r, setR] = useState<Rascunho>(inicial);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const temAviso = r.dmMessage.replace(/\r\n/g, "\n").includes(AVISO_OBRIGATORIO);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!temAviso) {
      setErro(`A DM precisa conter o aviso: "${AVISO_OBRIGATORIO}"`);
      return;
    }
    setSalvando(true);
    setErro(await onSalvar(r));
    setSalvando(false);
  }

  return (
    <form onSubmit={enviar} className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{titulo}</h3>
      <p className="rounded-md border border-border bg-surface-hover p-3 text-xs text-muted">{AVISO_COMPLIANCE}</p>
      <label className="block text-xs text-muted">
        Palavra
        <input
          className={`${CAMPO} mt-1 uppercase`}
          value={r.palavra}
          maxLength={40}
          onChange={(e) => setR({ ...r, palavra: e.target.value })}
          placeholder="JUROS"
          required
        />
      </label>
      <label className="block text-xs text-muted">
        Texto da DM
        <textarea
          className={`${CAMPO} mt-1 min-h-32`}
          value={r.dmMessage}
          maxLength={1000}
          onChange={(e) => setR({ ...r, dmMessage: e.target.value })}
          required
        />
        <span className={`mt-1 block ${temAviso ? "text-success" : "text-error"}`}>
          {temAviso ? "Aviso obrigatório presente." : "Falta o aviso obrigatório."}
        </span>
      </label>
      <button
        type="button"
        className={BTN_SECUNDARIO}
        onClick={() =>
          setR({ ...r, dmMessage: `${r.dmMessage.trimEnd()}${r.dmMessage.trim() ? "\n" : ""}${AVISO_OBRIGATORIO}` })
        }
        disabled={temAviso}
      >
        Inserir aviso
      </button>
      <label className="block text-xs text-muted">
        Resposta pública no comentário
        <input
          className={`${CAMPO} mt-1`}
          value={r.respostaPublica}
          maxLength={300}
          onChange={(e) => setR({ ...r, respostaPublica: e.target.value })}
        />
        <span className="mt-1 block">Com o portão ligado, só sai a frase padrão &ldquo;{RESPOSTA_PUBLICA_PADRAO}&rdquo;.</span>
      </label>
      <label className="flex items-center gap-2 text-sm text-foreground">
        <input type="checkbox" checked={r.ativo} onChange={(e) => setR({ ...r, ativo: e.target.checked })} />
        Ativo (o portão aceita este texto)
      </label>
      {erro && <p className="text-sm text-error">{erro}</p>}
      <div className="flex gap-2">
        <button type="submit" className={BTN_PRIMARIO} disabled={salvando}>
          {salvando ? "Salvando..." : "Salvar"}
        </button>
        {onCancelar && (
          <button type="button" className={BTN_SECUNDARIO} onClick={onCancelar}>
            Cancelar
          </button>
        )}
      </div>
    </form>
  );
}

export function PalavrasManager() {
  const [textos, setTextos] = useState<Texto[] | null>(null);
  const [semDm, setSemDm] = useState<SemDm[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    const r = await chamar("/api/opi/textos");
    if (!r.ok) {
      setErro(r.erro ?? "Falha ao carregar");
      return;
    }
    const d = (r.json as { data: { textos: Texto[]; semDm: SemDm[] } }).data;
    setTextos(d.textos);
    setSemDm(d.semDm);
    setErro(null);
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  async function criar(r: Rascunho) {
    const res = await chamar("/api/opi/textos", { method: "POST", body: JSON.stringify(r) });
    if (!res.ok) return res.erro ?? "Falha ao salvar";
    setCriando(false);
    await carregar();
    return null;
  }

  async function editar(id: string, r: Partial<Rascunho>) {
    const res = await chamar(`/api/opi/textos/${id}`, { method: "PATCH", body: JSON.stringify(r) });
    if (!res.ok) return res.erro ?? "Falha ao salvar";
    setEditando(null);
    await carregar();
    return null;
  }

  async function apagar(t: Texto) {
    if (!await confirmar(`Apagar o texto da palavra ${t.palavra}? As campanhas com esse texto ficam bloqueadas pelo portão.`)) return;
    setOcupado(t.id);
    const res = await chamar(`/api/opi/textos/${t.id}`, { method: "DELETE" });
    setOcupado(null);
    if (!res.ok) setAviso(res.erro ?? "Falha ao apagar");
    await carregar();
  }

  async function alternarTexto(t: Texto) {
    setOcupado(t.id);
    const e = await editar(t.id, { ativo: !t.ativo });
    setOcupado(null);
    if (e) setAviso(e);
  }

  async function alternarCampanha(c: Campanha, ativar: boolean) {
    setOcupado(c.id);
    const res = await chamar(`/api/automations?id=${encodeURIComponent(c.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ isActive: ativar }),
    });
    setOcupado(null);
    setAviso(res.ok ? null : res.erro ?? "Falha ao alterar a campanha");
    await carregar();
  }

  async function reprocessar(l: SemDm) {
    setOcupado(l.id);
    const res = await chamar("/api/opi/reprocessar", { method: "POST", body: JSON.stringify({ dmLogId: l.id }) });
    setOcupado(null);
    setAviso(res.ok ? "Comentário de volta na fila. O portão do Jev decide de novo." : res.erro ?? "Falha ao reprocessar");
    await carregar();
  }

  if (erro) {
    return (
      <Card title="Não deu para carregar">
        <p className="text-sm text-error">{erro}</p>
        <button className={`${BTN_SECUNDARIO} mt-3`} onClick={() => void carregar()}>
          Tentar de novo
        </button>
      </Card>
    );
  }
  if (!textos) return <p className="text-sm text-muted">Carregando...</p>;

  return (
    <div className="space-y-4">
      {aviso && (
        <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-surface p-3 text-sm text-foreground">
          <span>{aviso}</span>
          <button className="text-muted hover:text-foreground" onClick={() => setAviso(null)} aria-label="Fechar aviso">
            ×
          </button>
        </div>
      )}

      <Card
        title="Textos aprovados"
        actions={
          !criando && (
            <button className={BTN_PRIMARIO} onClick={() => setCriando(true)}>
              Novo texto
            </button>
          )
        }
      >
        {criando && (
          <div className="mb-4 rounded-md border border-border p-4">
            <FormTexto inicial={VAZIO} titulo="Novo texto" onSalvar={criar} onCancelar={() => setCriando(false)} />
          </div>
        )}
        {textos.length === 0 && !criando && (
          <p className="text-sm text-muted">
            Nenhum texto aprovado no painel ainda. Os textos fixos do código (JUROS e ERROS) continuam valendo.
          </p>
        )}
        <ul className="space-y-3">
          {textos.map((t) => (
            <li key={t.id} className="rounded-md border border-border p-4">
              {editando === t.id ? (
                <FormTexto
                  inicial={{ palavra: t.palavra, dmMessage: t.dmMessage, respostaPublica: t.respostaPublica, ativo: t.ativo }}
                  titulo={`Editar ${t.palavra}`}
                  onSalvar={(r) => editar(t.id, r)}
                  onCancelar={() => setEditando(null)}
                />
              ) : (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-foreground">{t.palavra}</span>
                      <Badge tone={t.ativo ? "success" : "error"}>{t.ativo ? "ativo" : "inativo"}</Badge>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button className={BTN_SECUNDARIO} onClick={() => setEditando(t.id)} disabled={ocupado === t.id}>
                        Editar
                      </button>
                      <button className={BTN_SECUNDARIO} onClick={() => void alternarTexto(t)} disabled={ocupado === t.id}>
                        {t.ativo ? "Desativar" : "Ativar"}
                      </button>
                      <button className={BTN_PERIGO} onClick={() => void apagar(t)} disabled={ocupado === t.id}>
                        Apagar
                      </button>
                    </div>
                  </div>
                  <pre className="mt-3 whitespace-pre-wrap break-words rounded-md bg-background p-3 font-sans text-sm text-foreground">
                    {t.dmMessage}
                  </pre>
                  <p className="mt-2 text-xs text-muted">
                    Resposta pública: <span className="text-foreground">{t.respostaPublica}</span>
                  </p>

                  <div className="mt-3">
                    <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Campanhas com esta palavra</p>
                    {t.campanhas.length === 0 ? (
                      <p className="text-sm text-muted">Nenhuma campanha usa esta palavra.</p>
                    ) : (
                      <ul className="divide-y divide-border rounded-md border border-border">
                        {t.campanhas.map((c) => (
                          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                            <div className="flex min-w-0 items-center gap-2">
                              <span className="truncate text-sm text-foreground">{c.name}</span>
                              <Badge tone={MOTIVO[c.motivo].tone}>{MOTIVO[c.motivo].label}</Badge>
                            </div>
                            {c.motivo === "ativa" ? (
                              <button
                                className={BTN_SECUNDARIO}
                                onClick={() => void alternarCampanha(c, false)}
                                disabled={ocupado === c.id}
                              >
                                Pausar
                              </button>
                            ) : (
                              <button
                                className={BTN_PRIMARIO}
                                onClick={() => void alternarCampanha(c, true)}
                                disabled={ocupado === c.id}
                              >
                                {c.motivo === "aguardando_revisao" ? "Reativar" : "Ativar"}
                              </button>
                            )}
                            {c.motivo === "aguardando_revisao" && (
                              <p className="w-full text-xs text-muted">
                                A 1ª DM deste texto saiu e a campanha parou para você conferir. Confira a DM no Instagram e
                                reative.
                              </p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              )}
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Comentários sem DM">
        {semDm.length === 0 ? (
          <p className="text-sm text-muted">Nenhum comentário parado.</p>
        ) : (
          <ul className="divide-y divide-border">
            {semDm.map((l) => (
              <li key={l.id} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm text-foreground">@{l.commenterName ?? "desconhecido"}</span>
                    <Badge tone={l.status === "FAILED" ? "error" : "neutral"}>{STATUS_LABEL[l.status] ?? l.status}</Badge>
                    <span className="text-xs text-muted">{new Date(l.createdAt).toLocaleString("pt-BR")}</span>
                  </div>
                  <p className="mt-1 break-words text-sm text-muted">&ldquo;{l.commentText}&rdquo;</p>
                  <p className="mt-1 text-xs text-muted">
                    Campanha: {l.automation.name}
                    {(l.jevReason || l.errorMessage) && ` · ${l.jevReason ?? l.errorMessage}`}
                  </p>
                </div>
                <button className={BTN_SECUNDARIO} onClick={() => void reprocessar(l)} disabled={ocupado === l.id}>
                  {ocupado === l.id ? "Enviando..." : "Reprocessar"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
