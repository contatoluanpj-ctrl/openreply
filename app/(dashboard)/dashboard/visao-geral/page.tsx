import { Badge, Card, PageHeader } from "@/components/opi";

export const dynamic = "force-dynamic";

export default function VisaoGeralPage() {
  return (
    <div>
      <PageHeader
        title="Visão geral"
        description="Resumo da OPI: redes, campanhas, calendário e caixa em um só lugar."
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
