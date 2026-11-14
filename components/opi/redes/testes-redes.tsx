"use client";

import { useState } from "react";
import { Badge } from "@/components/opi";

type Resultado = { rede: string; ok: boolean; conta: string | null; detalhe: string; semConfiguracao: boolean };
type Envio = { ok: boolean; rede: string; detalhe: string; link?: string | null };

const NOME: Record<string, string> = { instagram: "Instagram", facebook: "Facebook", youtube: "YouTube", linkedin: "LinkedIn", x: "X" };

const BOTAO =
  "inline-flex items-center justify-center rounded-xl border border-border px-3.5 py-2 text-sm font-semibold text-foreground transition hover:border-accent disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Painel "Conexões" da tela Redes: testa de verdade cada rede (leitura) e permite um envio de teste que não
 * aparece para o público (YouTube privado, Facebook em rascunho). `aoTestar` recarrega os cards.
 */
export function TestesRedes({ aoTestar }: { aoTestar?: () => void }) {
  const [testando, setTestando] = useState(false);
  const [resultados, setResultados] = useState<Resultado[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState<string | null>(null);
  const [envios, setEnvios] = useState<Record<string, Envio>>({});

  async function testar() {
    setTestando(true);
    setErro(null);
    try {
      const res = await fetch("/api/opi/redes/testar", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const corpo = (await res.json().catch(() => ({}))) as { resultados?: Resultado[]; error?: string };
      if (!res.ok || !corpo.resultados) throw new Error(corpo.error ?? "Não foi possível testar agora.");
      setResultados(corpo.resultados);
      aoTestar?.();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro inesperado.");
    } finally {
      setTestando(false);
    }
  }

  async function enviarTeste(rede: "youtube" | "facebook") {
    const aviso =
      rede === "youtube"
        ? "Enviar um vídeo de teste PRIVADO para o canal do YouTube? Só você vê; pode apagar depois."
        : "Enviar um Reel de teste como RASCUNHO da Página do Facebook? Não aparece para o público; pode apagar depois.";
    if (!window.confirm(aviso)) return;
    setEnviando(rede);
    try {
      const res = await fetch("/api/opi/redes/teste-publicacao", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rede }),
      });
      const corpo = (await res.json().catch(() => ({}))) as Partial<Envio> & { error?: string };
      setEnvios((a) => ({
        ...a,
        [rede]: { ok: corpo.ok === true, rede, detalhe: corpo.detalhe ?? corpo.error ?? "Sem resposta do painel.", link: corpo.link ?? null },
      }));
    } catch {
      setEnvios((a) => ({ ...a, [rede]: { ok: false, rede, detalhe: "Falha de rede ao pedir o envio de teste." } }));
    } finally {
      setEnviando(null);
    }
  }

  return (
    <section className="opi-glass mb-4 p-5" aria-labelledby="conexoes-titulo">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="conexoes-titulo" className="font-display text-base font-bold text-foreground">
            Conexões
          </h2>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            O teste faz uma leitura real em cada rede, com a mesma credencial que publica. Nada é publicado. &quot;Conectado&quot; só aparece
            quando a conta certa respondeu.
          </p>
        </div>
        <button type="button" className={BOTAO} onClick={testar} disabled={testando} aria-busy={testando}>
          {testando ? "Testando…" : "Testar conexões"}
        </button>
      </div>

      {erro && (
        <p role="alert" className="mt-3 text-sm text-error">
          {erro}
        </p>
      )}

      {resultados && (
        <ul className="mt-4 grid grid-cols-1 gap-2 md:grid-cols-2" aria-live="polite">
          {resultados.map((r) => (
            <li key={r.rede} className="opi-inset flex min-w-0 items-start justify-between gap-3 px-3 py-2.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{NOME[r.rede] ?? r.rede}</p>
                <p className="mt-0.5 break-words text-xs text-muted">{r.detalhe}</p>
              </div>
              <Badge tone={r.ok ? "success" : r.semConfiguracao ? "neutral" : "error"}>
                {r.ok ? "Conectado" : r.semConfiguracao ? "Não ligado" : "Falhou"}
              </Badge>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-5 border-t border-border pt-4">
        <p className="text-sm font-semibold text-foreground">Envio de teste (não aparece para o público)</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <button type="button" className={BOTAO} onClick={() => enviarTeste("youtube")} disabled={enviando !== null}>
            {enviando === "youtube" ? "Enviando ao YouTube…" : "YouTube: vídeo privado"}
          </button>
          <button type="button" className={BOTAO} onClick={() => enviarTeste("facebook")} disabled={enviando !== null}>
            {enviando === "facebook" ? "Enviando ao Facebook…" : "Facebook: rascunho"}
          </button>
        </div>
        {enviando && <p className="mt-2 text-xs text-muted">O envio leva de 30 segundos a 2 minutos. Não feche a página.</p>}
        <ul className="mt-2 space-y-1" aria-live="polite">
          {Object.values(envios).map((e) => (
            <li key={e.rede} className={`text-sm ${e.ok ? "text-success" : "text-error"}`}>
              {NOME[e.rede]}: {e.detalhe}{" "}
              {e.ok && e.link && (
                <a className="underline" href={e.link} target="_blank" rel="noreferrer">
                  Abrir
                </a>
              )}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
