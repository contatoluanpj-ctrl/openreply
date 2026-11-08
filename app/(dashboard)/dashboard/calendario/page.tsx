import { Badge, Card, PageHeader } from "@/components/opi";

export const dynamic = "force-dynamic";

export default function CalendarioPage() {
  return (
    <div>
      <PageHeader
        title="Calendário"
        description="Posts agendados. Só publica item de calendário aprovado pelo Luan (D-0026), com o aviso obrigatório na legenda."
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
