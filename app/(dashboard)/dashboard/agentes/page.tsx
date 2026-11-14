import { PageHeader } from "@/components/opi";
import { Equipe } from "@/components/opi/agentes/equipe";

export const dynamic = "force-dynamic";

export default function AgentesPage() {
  return (
    <div>
      <PageHeader
        title="Equipe"
        description="Você no topo e os diretores em cartões. Clique num diretor para ver a equipe dele; clique em alguém da equipe para mandar um pedido."
      />
      <Equipe />
    </div>
  );
}
