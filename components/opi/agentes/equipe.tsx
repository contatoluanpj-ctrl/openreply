"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "@/components/opi";
import type { ResumoAgente } from "@/lib/opi/agentes-dados";
import { Organograma } from "./organograma";
import { PainelAgente } from "./painel-agente";

/** Organograma clicável; o painel do agente abre à direita. Polling só com o painel aberto. */
export function Equipe() {
  const [selecionado, setSelecionado] = useState<string | null>(null);
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
    // eslint-disable-next-line react-hooks/set-state-in-effect -- busca inicial; o setState acontece depois do fetch
    void carregarResumo();
  }, [carregarResumo]);

  const atualizar = useCallback(() => void carregarResumo(), [carregarResumo]);
  const fechar = useCallback(() => setSelecionado(null), []);

  return (
    <>
      <Card title="Organograma">
        <Organograma resumo={resumo} selecionado={selecionado} onSelecionar={setSelecionado} />
      </Card>
      {selecionado && (
        <PainelAgente key={selecionado} agente={selecionado} onFechar={fechar} onAtividade={atualizar} />
      )}
    </>
  );
}
