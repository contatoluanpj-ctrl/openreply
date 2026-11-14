// Dados da página padrão de departamento (/dashboard/departamento/[slug]). Só leitura.
// Nada de nome nem telefone de lead: dos pedidos saem só o agente, o estado e a data (o texto do pedido
// fica na tela Agentes); das pendências saem só contagens (lib/opi/hoje.ts).
import type { PrismaClient } from "@/app/generated/prisma/client";
import { agentesDoDepartamento, pendenciasDoDepartamento, type Departamento, type ItemPendencia } from "@/lib/opi/departamentos";
import { carregarHoje, type DbHoje } from "@/lib/opi/hoje";
import { bloco, LINKS, type Bloco } from "@/lib/opi/visao-geral";

export type DbDepartamento = DbHoje & Pick<PrismaClient, "pedidoAgente">;

const SEMANA_MS = 7 * 24 * 60 * 60 * 1000;
const LIMITE_PEDIDOS = 20;

export type PedidoAberto = {
  id: string;
  agente: string;
  status: "NOVO" | "EM_ANDAMENTO";
  createdAt: Date;
};

export type DadosDepartamento = {
  pedidos: Bloco<PedidoAberto[]>;
  pendencias: Bloco<ItemPendencia[]>;
};

const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Pedido com erro na última semana vira uma pendência só, apontando para a tela Agentes. */
export function pendenciaDePedidosComErro(total: number): ItemPendencia[] {
  if (total <= 0) return [];
  return [
    {
      texto: `${plural(total, "pedido da equipe terminou", "pedidos da equipe terminaram")} com erro nos últimos 7 dias`,
      href: LINKS.agentes,
      nivel: "erro",
    },
  ];
}

/**
 * Junta o que espera o Luan neste departamento: erros de pedido da equipe, erros das últimas 24 h e
 * itens "esperando você" cujas telas moram aqui. Erro primeiro.
 */
export function montarPendenciasDoDepartamento(
  dep: Departamento,
  x: { pedidosComErro: number; gerais: readonly ItemPendencia[] },
): ItemPendencia[] {
  const itens = [...pendenciaDePedidosComErro(x.pedidosComErro), ...pendenciasDoDepartamento(dep, x.gerais)];
  return [...itens.filter((i) => i.nivel === "erro"), ...itens.filter((i) => i.nivel !== "erro")];
}

export async function carregarDepartamento(
  db: DbDepartamento,
  workspaceId: string,
  dep: Departamento,
  agora: Date = new Date(),
): Promise<DadosDepartamento> {
  const agentes = agentesDoDepartamento(dep);
  const temTelas = dep.ferramentas.length > 0;

  const [pedidos, pedidosComErro, hoje] = await Promise.all([
    bloco(async () => {
      if (agentes.length === 0) return [];
      const linhas = await db.pedidoAgente.findMany({
        where: { workspaceId, agente: { in: agentes }, status: { in: ["NOVO", "EM_ANDAMENTO"] } },
        orderBy: { createdAt: "asc" },
        // Sem `mensagem`: o texto do pedido não sai daqui.
        select: { id: true, agente: true, status: true, createdAt: true },
        take: LIMITE_PEDIDOS,
      });
      return linhas.map((p) => ({ id: p.id, agente: p.agente, status: p.status as PedidoAberto["status"], createdAt: p.createdAt }));
    }),
    bloco(async () => {
      if (agentes.length === 0) return 0;
      return db.pedidoAgente.count({
        where: { workspaceId, agente: { in: agentes }, status: "ERRO", updatedAt: { gte: new Date(agora.getTime() - SEMANA_MS) } },
      });
    }),
    // As pendências gerais só interessam a quem tem tela: departamento sem tela não dispara essas consultas.
    temTelas ? carregarHoje(db, workspaceId, agora) : Promise.resolve(null),
  ]);

  const gerais: ItemPendencia[] = hoje
    ? [...(hoje.erros.ok ? hoje.erros.dados : []), ...(hoje.esperando.ok ? hoje.esperando.dados : [])]
    : [];
  const tudoFalhou = !pedidosComErro.ok && hoje !== null && !hoje.erros.ok && !hoje.esperando.ok;

  const pendencias: Bloco<ItemPendencia[]> =
    tudoFalhou || (!pedidosComErro.ok && hoje === null)
      ? { ok: false, motivo: pedidosComErro.ok ? "erro" : pedidosComErro.motivo }
      : {
          ok: true,
          dados: montarPendenciasDoDepartamento(dep, {
            pedidosComErro: pedidosComErro.ok ? pedidosComErro.dados : 0,
            gerais,
          }),
        };

  return { pedidos, pendencias };
}
