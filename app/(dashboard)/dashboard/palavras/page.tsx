import { PageHeader } from "@/components/opi";
import { PalavrasManager } from "@/components/opi/palavras/palavras-manager";

export const dynamic = "force-dynamic";

export default function PalavrasPage() {
  return (
    <div>
      <PageHeader
        title="Palavras-chave"
        description="Palavras que disparam DM, com os textos aprovados pelo Luan e as campanhas de cada uma."
      />
      <PalavrasManager />
    </div>
  );
}
