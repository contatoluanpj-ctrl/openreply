import { Badge, Card, PageHeader } from "@/components/opi";

export const dynamic = "force-dynamic";

export default function PalavrasPage() {
  return (
    <div>
      <PageHeader
        title="Palavras-chave"
        description="Palavras que disparam DM, com os textos aprovados pelo Luan."
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
