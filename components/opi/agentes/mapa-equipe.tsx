"use client";

import { C_LEVELS, FUNDADOR, OPERACIONAIS, STATUS_LABEL, type MembroEquipe } from "@/lib/opi/agentes";

export interface ResumoAgente {
  agente: string;
  ativo: boolean;
  ultimo: string | null;
}

interface MapaEquipeProps {
  resumo: ResumoAgente[];
  selecionado: string;
  onSelecionar: (agente: string) => void;
}

function Ponto({ ativo }: { ativo: boolean }) {
  return (
    <span
      aria-label={ativo ? "Ativo" : "Inativo"}
      title={ativo ? "Ativo agora" : "Inativo"}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${ativo ? "bg-success" : "bg-muted/50"}`}
    />
  );
}

function NoEquipe({ membro, ativo, selecionado, onClick }: {
  membro: MembroEquipe; ativo: boolean; selecionado?: boolean; onClick?: () => void;
}) {
  const conteudo = (
    <>
      <span className="flex items-center gap-2">
        <Ponto ativo={ativo} />
        <span className="truncate text-sm font-medium text-foreground">{membro.nome}</span>
      </span>
      <span className="mt-0.5 block truncate text-xs text-muted">{membro.papel}</span>
      {membro.status && (
        <span className="mt-1 block text-[11px] text-muted/70">{STATUS_LABEL[membro.status]}</span>
      )}
      {membro.chat && <span className="mt-1 block text-[11px] font-medium text-foreground/80">Abrir chat</span>}
    </>
  );
  const base = "block w-full min-w-0 rounded-md border px-3 py-2 text-left transition-colors";
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={selecionado}
        className={`${base} ${selecionado ? "border-foreground bg-surface-hover" : "border-border bg-background hover:border-border-hover hover:bg-surface-hover"}`}
      >
        {conteudo}
      </button>
    );
  }
  return <div className={`${base} border-border bg-background`}>{conteudo}</div>;
}

/** Luan no topo, todos os C-levels no mesmo nível, operacionais abaixo de quem reportam. */
export function MapaEquipe({ resumo, selecionado, onSelecionar }: MapaEquipeProps) {
  const ativoDe = (id: string) => resumo.find((r) => r.agente === id)?.ativo ?? false;
  const chefes = C_LEVELS.filter((c) => OPERACIONAIS.some((o) => o.reportaA === c.id));

  return (
    <div className="space-y-6">
      <div className="flex justify-center">
        <div className="w-full max-w-xs">
          <NoEquipe membro={FUNDADOR} ativo />
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">C-levels</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          {C_LEVELS.map((c) => (
            <NoEquipe key={c.id} membro={c} ativo={false} />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Operacionais</p>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {chefes.map((chefe) => (
            <div key={chefe.id} className="rounded-md border border-border p-3">
              <p className="mb-2 text-xs text-muted">
                Reportam a <span className="font-medium text-foreground">{chefe.nome}</span>
              </p>
              <div className="space-y-2">
                {OPERACIONAIS.filter((o) => o.reportaA === chefe.id).map((o) => (
                  <NoEquipe
                    key={o.id}
                    membro={o}
                    ativo={o.chat ? ativoDe(o.id) : false}
                    selecionado={o.id === selecionado}
                    onClick={o.chat ? () => onSelecionar(o.id) : undefined}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <p className="text-xs text-muted">
        Ponto verde: pedido em andamento ou atividade nos últimos 15 minutos. Cinza: inativo.
      </p>
    </div>
  );
}
