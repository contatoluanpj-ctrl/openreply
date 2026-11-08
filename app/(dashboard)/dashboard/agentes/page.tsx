import { PageHeader } from "@/components/opi";
import { Equipe } from "@/components/opi/agentes/equipe";

export const dynamic = "force-dynamic";

export default function AgentesPage() {
  return (
    <div>
      <PageHeader
        title="Equipe"
        description="Quem faz o quê na OPI e o chat com os agentes executores. Os pedidos são respondidos pelo runner local."
      />
      <Equipe />
    </div>
  );
}
