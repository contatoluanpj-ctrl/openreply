import { Badge, Card, PageHeader } from "@/components/opi";

export const dynamic = "force-dynamic";

export default function AgentesPage() {
  return (
    <div>
      <PageHeader
        title="Agentes"
        description="Pedidos para os agentes da equipe e o andamento de cada um (escopo agentes:rw)."
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
