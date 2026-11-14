"use client";

import { useState } from "react";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/top-bar";
import { TEMA_PADRAO, cookieDoTema, type TemaOpi } from "@/lib/opi/tema";

interface DashboardShellProps {
  children: React.ReactNode;
  workspaceName: string;
  instagramUsername: string | null;
  instagramAccountCount: number;
  /** Variante do tema lida do cookie no servidor ("a" preto, "b" grafite). */
  temaInicial?: TemaOpi;
  /** Rota a marcar no menu no lugar da rota do navegador (só a prévia local usa). */
  rotaAtual?: string;
}

export default function DashboardShell({
  children,
  workspaceName,
  instagramUsername,
  instagramAccountCount,
  temaInicial = TEMA_PADRAO,
  rotaAtual,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [tema, setTema] = useState<TemaOpi>(temaInicial);

  function trocarTema(novo: TemaOpi) {
    setTema(novo);
    document.cookie = cookieDoTema(novo);
  }

  return (
    // h-dvh, not h-screen: on mobile browsers the URL bar eats into 100vh, which
    // would push the composer and pagination controls below the fold.
    <div data-tema={tema} className="opi-central flex h-dvh overflow-hidden bg-background text-foreground">
      <div className="opi-aura" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaceName={workspaceName}
        tema={tema}
        onTema={trocarTema}
        rotaAtual={rotaAtual}
      />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          instagramUsername={instagramUsername}
          instagramAccountCount={instagramAccountCount}
        />

        {/* overflow-x-hidden: enabling vertical scrolling makes the browser
            allow horizontal scrolling too, which lets a wide child drag the
            whole page sideways on a phone. */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="px-4 lg:px-10 py-6 sm:py-8 max-w-[1240px] mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
