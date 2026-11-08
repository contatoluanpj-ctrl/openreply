import { PageHeader } from "@/components/opi";
import { ChatCentral } from "@/components/opi/chat/chat-central";

export const dynamic = "force-dynamic";

export default function ChatPage() {
  return (
    <div>
      <PageHeader
        title="Chat central"
        description="Escreva o que você quer. O Jev aponta quem faz, você confirma e o pedido vai direto para a fila do agente certo."
      />
      <ChatCentral />
    </div>
  );
}
