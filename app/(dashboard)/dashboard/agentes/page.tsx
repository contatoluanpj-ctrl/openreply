import { PageHeader } from "@/components/opi";
import { Equipe } from "@/components/opi/agentes/equipe";

export const dynamic = "force-dynamic";

export default function AgentesPage() {
  return (
    <div>
      <PageHeader
        title="Equipe"
        description="Você no topo, os C-levels no mesmo nível e a equipe de cada um embaixo. Clique em qualquer agente para mandar um pedido."
      />
      <Equipe />
    </div>
  );
}
