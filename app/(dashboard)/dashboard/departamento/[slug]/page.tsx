// Página padrão de departamento do OPI Central: diretor e equipe, pedidos em aberto, o que espera o Luan
// e as telas do departamento. Só leitura; departamento sem tela mostra o estado vazio, sem número inventado.
import { notFound, redirect } from "next/navigation";
import { PaginaDepartamento } from "@/components/opi/departamento/pagina-departamento";
import { getCurrentWorkspaceId } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { carregarDepartamento } from "@/lib/opi/departamento-dados";
import { departamentoPorSlug } from "@/lib/opi/departamentos";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const dep = departamentoPorSlug((await params).slug);
  return { title: dep ? `${dep.nome} · OPI Central` : "OPI Central" };
}

export default async function DepartamentoPage({ params }: { params: Promise<{ slug: string }> }) {
  const dep = departamentoPorSlug((await params).slug);
  if (!dep) notFound();

  const workspaceId = await getCurrentWorkspaceId();
  if (!workspaceId) redirect("/login");

  const dados = await carregarDepartamento(prisma, workspaceId, dep);
  return <PaginaDepartamento dep={dep} dados={dados} />;
}
