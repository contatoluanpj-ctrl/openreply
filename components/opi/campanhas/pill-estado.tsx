// Pílula Ativa/Pausada das campanhas (separada do painel para não puxar o recharts junto).
export function PillEstado({ ativa }: { ativa: boolean }) {
  return ativa ? (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-[#D9541E]/45 bg-[#D9541E]/10 px-2.5 py-[3px] text-[11px] font-bold text-[#D9541E]">
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-[#D9541E]" />
      Ativa
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border border-error/35 bg-error/[.06] px-2.5 py-[3px] text-[11px] font-bold text-error/80">
      Pausada
    </span>
  );
}
