import { I18nProvider } from "@/lib/i18n/provider";
import { getI18n } from "@/lib/i18n/server";
import { redirect } from "next/navigation";
import DashboardShell from "@/components/dashboard-shell";
import { sessaoAtual } from "@/lib/auth";
import { prisma } from "@/lib/db/client";
import { acceptPendingInvitationsForUser, ensureWorkspaceForUser, getPrimaryWorkspace } from "@/lib/workspace";

export async function generateMetadata() {
  return { title: "OPI Central" };
}

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { locale } = await getI18n();
  const session = await sessaoAtual();

  if (!session?.user?.id) {
    redirect("/login");
  }

  // O layout só roda na carga completa (navegar entre seções reaproveita o layout), mas cada ida
  // ao banco pesa: o convite pendente e o workspace principal saem em paralelo, e só quem ainda
  // não tem workspace passa pelo ensureWorkspaceForUser.
  const userId = session.user.id;
  const [primario] = await Promise.all([
    getPrimaryWorkspace(userId),
    acceptPendingInvitationsForUser(userId, session.user.email),
  ]);
  const workspace = primario ?? (await ensureWorkspaceForUser(userId, session.user.email));
  const accounts = await prisma.instagramAccount.findMany({
    where: { workspaceId: workspace.id },
    orderBy: { connectedAt: "desc" },
    select: { username: true },
  });

  return (
    <I18nProvider locale={locale}>
      <DashboardShell
        workspaceName={workspace.name}
        instagramUsername={accounts[0]?.username ?? null}
        instagramAccountCount={accounts.length}
      >
        {children}
      </DashboardShell>
    </I18nProvider>
  );
}
