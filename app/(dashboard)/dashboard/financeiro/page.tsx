import { PageHeader } from "@/components/opi";
import { PainelFinanceiro } from "@/components/opi/financeiro/painel-financeiro";

export const dynamic = "force-dynamic";

export default function FinanceiroPage() {
  return (
    <div>
      <PageHeader
        title="Financeiro"
        description="Receitas e despesas da OPI. Ads apenas em leitura: nenhum gasto sai daqui."
      />
      <PainelFinanceiro />
    </div>
  );
}
