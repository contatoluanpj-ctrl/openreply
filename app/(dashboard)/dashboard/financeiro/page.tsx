import { Badge, Card, PageHeader } from "@/components/opi";

export const dynamic = "force-dynamic";

export default function FinanceiroPage() {
  return (
    <div>
      <PageHeader
        title="Financeiro"
        description="Receitas e despesas da OPI. Ads apenas em leitura: nenhum gasto sai daqui."
        actions={<Badge>Em construção</Badge>}
      />
      <Card title="Em breve">
        <p className="text-sm text-muted">
          Esta página faz parte do OPI Central e ainda está sendo montada.
        </p>
      </Card>
    </div>
  );
}
