"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/opi";
import { AGENTES_CHAT, nomeDoAgente, type AgenteChat } from "@/lib/opi/agentes";
import { ChatAgente } from "./chat-agente";
import { MapaEquipe, type ResumoAgente } from "./mapa-equipe";

const POLL_MS = 5000;

export function Equipe() {
  const [selecionado, setSelecionado] = useState<AgenteChat>(AGENTES_CHAT[0]);
  const [resumo, setResumo] = useState<ResumoAgente[]>([]);

  const carregarResumo = useCallback(async () => {
    try {
      const res = await fetch("/api/agentes", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as { data: ResumoAgente[] };
      setResumo(json.data);
    } catch {
      /* mantém o último resumo */
    }
  }, []);

  useEffect(() => {
    void carregarResumo();
    const timer = setInterval(() => void carregarResumo(), POLL_MS);
    return () => clearInterval(timer);
  }, [carregarResumo]);

  const selecionar = (id: string) => {
    if ((AGENTES_CHAT as readonly string[]).includes(id)) setSelecionado(id as AgenteChat);
  };

  return (
    <div className="space-y-6">
      <Card title="Mapa da equipe">
        <MapaEquipe resumo={resumo} selecionado={selecionado} onSelecionar={selecionar} />
      </Card>

      <Card title={`Chat: ${nomeDoAgente(selecionado)}`}>
        <div role="tablist" aria-label="Agentes com chat" className="mb-4 flex flex-wrap gap-2">
          {AGENTES_CHAT.map((id) => {
            const ativo = resumo.find((r) => r.agente === id)?.ativo ?? false;
            return (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={id === selecionado}
                onClick={() => setSelecionado(id)}
                className={`flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm transition-colors ${
                  id === selecionado
                    ? "border-foreground bg-surface-hover text-foreground"
                    : "border-border text-muted hover:border-border-hover hover:text-foreground"
                }`}
              >
                <span className={`h-2 w-2 rounded-full ${ativo ? "bg-success" : "bg-muted/50"}`} />
                {nomeDoAgente(id)}
              </button>
            );
          })}
        </div>
        <ChatAgente key={selecionado} agente={selecionado} onAtividade={carregarResumo} />
      </Card>
    </div>
  );
}
