import { Badge, Card, PageHeader } from "@/components/opi";

export const dynamic = "force-dynamic";

export default function RedesPage() {
  return (
    <div>
      <PageHeader
        title="Redes"
        description="Seguidores, alcance e publicações por rede. Dados enviados pelos agentes (escopo redes:write)."
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
