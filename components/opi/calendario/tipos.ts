import type { DestinoView } from "@/lib/opi/destinos";
import type { PostStatusOpi, PostTipoOpi } from "@/lib/opi/posts-schema";

/** Forma do PostAgendado como chega da API (datas em ISO). */
export type PostCalendario = {
  id: string;
  tipo: PostTipoOpi;
  midias: unknown;
  legenda: string;
  agendadoPara: string;
  status: PostStatusOpi;
  aprovadoEm: string | null;
  aprovadoPor: string | null;
  mediaId: string | null;
  permalink: string | null;
  erro: string | null;
  /** Destinos do post (uma rede cada), na ordem fixa das redes. Vazio enquanto o post não foi aprovado. */
  destinos?: DestinoView[];
};
