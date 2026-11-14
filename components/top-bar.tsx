"use client";

/**
 * Top Bar
 *
 * Page title, mobile hamburger, and connection status.
 */

import { useI18n } from "@/lib/i18n/provider";
import { usePathname } from "next/navigation";

const pageTitles: Record<string, string> = {
  "/overview": "Seguidores",
  "/inbox": "Caixa de entrada",
  "/campaigns/import": "Importar campanhas",
  "/campaigns/new": "Nova campanha",
  "/automations": "Automações",
  "/automations/new": "Nova campanha",
  "/logs": "Registro de DMs",
  "/settings": "Configurações",
  "/diagnostics": "Diagnóstico",
  "/integrations": "Integrações",
};

interface TopBarProps {
  onMenuClick: () => void;
  instagramUsername: string | null;
  instagramAccountCount: number;
}

export default function TopBar({
  onMenuClick,
  instagramUsername,
  instagramAccountCount,
}: TopBarProps) {
  const { t } = useI18n();
  const pathname = usePathname();
  const title: string | null = pageTitles[pathname] ?? (
    pathname.endsWith("/edit") ? "Editar campanha"
      : pathname.startsWith("/campaigns/") ? "Detalhes da campanha" : null
  );

  return (
    <header
      className="sticky top-0 z-30 flex items-center justify-between gap-3 px-4 lg:px-10 bg-background/70 backdrop-blur-xl"
      // Installed to the home screen the app starts at the very top of the
      // display, so without this the title sits under the clock and battery.
      // The inset is 0 in a browser tab and on desktop.
      style={{
        height: "calc(4rem + env(safe-area-inset-top))",
        paddingTop: "env(safe-area-inset-top)",
      }}
    >
      <div className="flex min-w-0 items-center gap-3 sm:gap-4">
        <button
          onClick={onMenuClick}
          className="lg:hidden inline-flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-border bg-surface px-3.5 text-sm font-semibold text-foreground hover:bg-surface-hover"
          aria-label={t("Toggle sidebar")}
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
            <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
          </svg>
          {t("Menu")}
        </button>
        {title && (
          <h1 className="truncate font-display text-base font-bold sm:text-lg">{title}</h1>
        )}
      </div>

      {instagramAccountCount > 0 ? (
        <p className="ml-auto shrink-0 truncate rounded-full border border-border bg-surface px-3.5 py-1.5 text-xs font-semibold text-muted">
          {instagramAccountCount > 1
            ? t("{count} accounts", { count: instagramAccountCount })
            : `@${instagramUsername}`}
        </p>
      ) : (
        <a
          href="/api/instagram/connect"
          className="shrink-0 whitespace-nowrap text-sm font-medium px-3 py-1.5 rounded bg-accent text-accent-foreground hover:bg-accent-hover"
        >
          {/* Full label needs more room than a 360px header has to spare. */}
          <span className="sm:hidden">{t("Connect")}</span>
          <span className="hidden sm:inline">{t("Connect Instagram")}</span>
        </a>
      )}
    </header>
  );
}
