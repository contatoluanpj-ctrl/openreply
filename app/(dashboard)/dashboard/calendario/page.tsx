import { PageHeader } from "@/components/opi";
import { CalendarioMes } from "@/components/opi/calendario/calendario-mes";

export const dynamic = "force-dynamic";

export default function CalendarioPage() {
  return (
    <div>
      <PageHeader
        title="Calendário"
        description="Rascunhos de carrossel, imagem e Reel. Nada é publicado sem o calendário do mês aprovado pelo Luan (D-0026), e toda legenda precisa do aviso obrigatório."
      />
      <CalendarioMes />
    </div>
  );
}
