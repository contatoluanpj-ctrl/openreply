import { PageHeader } from "@/components/opi";
import { TabelaConteudo } from "@/components/opi/conteudo/tabela-conteudo";

export const dynamic = "force-dynamic";

export default function ConteudoPage() {
  return (
    <div className="pb-10">
      <PageHeader
        title="Conteúdo"
        description="Desempenho de cada Reel no Instagram. O número que importa para a OPI: quantas pessoas salvaram ou compartilharam a cada 1.000 visualizações."
      />
      <TabelaConteudo />
    </div>
  );
}
