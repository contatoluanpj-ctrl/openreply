"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge, Card, PageHeader } from "@/components/opi";
import { RedeCard } from "@/components/opi/redes/rede-card";
import { TestesRedes } from "@/components/opi/redes/testes-redes";
import type { RedeView } from "@/lib/opi/redes";

type Estado = { status: "carregando" } | { status: "erro"; mensagem: string } | { status: "ok"; redes: RedeView[] };

export default function RedesPage() {
  const [estado, setEstado] = useState<Estado>({ status: "carregando" });

  const carregar = useCallback((ativo: () => boolean = () => true) => {
    fetch("/api/opi/redes", { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(res.status === 401 ? "Sessão expirada. Entre de novo." : "Não foi possível carregar as redes.");
        const body = (await res.json()) as { data: RedeView[] };
        if (ativo()) setEstado({ status: "ok", redes: body.data });
      })
      .catch((e: unknown) => {
        if (ativo()) setEstado({ status: "erro", mensagem: e instanceof Error ? e.message : "Erro inesperado." });
      });
  }, []);

  useEffect(() => {
    let ativo = true;
    carregar(() => ativo);
    return () => {
      ativo = false;
    };
  }, [carregar]);

  const conectadas = estado.status === "ok" ? estado.redes.filter((r) => r.estado === "conectado").length : null;

  return (
    <div>
      <PageHeader
        title="Redes"
        description="Conexão testada de verdade e números de cada rede. Anúncios são só leitura: nenhum gasto sai do painel."
        actions={conectadas !== null ? <Badge>{conectadas} de 9 conectadas</Badge> : undefined}
      />
      <TestesRedes aoTestar={() => carregar()} />
      {estado.status === "carregando" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" aria-busy="true">
          {Array.from({ length: 9 }, (_, i) => (
            <div key={i} className="h-72 animate-pulse rounded-lg border border-border bg-surface" />
          ))}
        </div>
      )}
      {estado.status === "erro" && (
        <Card title="Erro">
          <p className="text-sm text-error">{estado.mensagem}</p>
        </Card>
      )}
      {estado.status === "ok" && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {estado.redes.map((rede) => (
            <RedeCard key={rede.id} rede={rede} />
          ))}
        </div>
      )}
    </div>
  );
}
