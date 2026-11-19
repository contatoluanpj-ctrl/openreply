import { issueSignedToken, presignUrl } from "@vercel/blob";
import { authenticateService, requireScope } from "@/lib/integrations/auth";
import { apiError, ApiError, checkOrigin, readJson } from "@/lib/integrations/http";
import { MidiaErro, emitirEnvioDeMidia, pedidoMidiaSchema } from "@/lib/opi/midia";

export const dynamic = "force-dynamic";

/**
 * POST /api/opi/midia { nome, tamanho } — chave de serviço com o escopo midia:write.
 * Devolve um endereço assinado para o PC subir UM arquivo (mp4, png ou jpg) direto ao armazenamento, com PUT.
 * Nada é publicado aqui e nenhum post é criado: é só o lugar onde a mídia fica até o post sair.
 */
export async function POST(request: Request) {
  try {
    checkOrigin(request);
    const context = await authenticateService(request);
    requireScope(context, "midia:write");
    const parsed = pedidoMidiaSchema.safeParse(await readJson(request, 4 * 1024));
    if (!parsed.success) throw new ApiError("Use { nome, tamanho } (tamanho em bytes)");
    let data;
    try {
      data = await emitirEnvioDeMidia(parsed.data, { sdk: { issueSignedToken, presignUrl } });
    } catch (e) {
      if (e instanceof MidiaErro) throw new ApiError(e.message, e.status);
      // Erro do SDK: nada de detalhe para fora (pode trazer id da loja ou trecho de credencial).
      console.error("[OPI mídia] falha ao assinar o envio:", e instanceof Error ? e.name : "erro");
      throw new ApiError("Armazenamento de mídia indisponível", 503);
    }
    return Response.json({ data }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
