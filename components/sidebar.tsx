"use client";

/**
 * Sidebar do OPI Central
 *
 * Navegação em grupos (Visão geral, Marketing, Financeiro, Operações, Equipe),
 * rótulos em português e tema preto/branco/cinza herdado de .opi-central.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { zernioLink } from "@/lib/zernio-links";

interface NavItem {
  label: string;
  href: string;
  /** Só marca ativo no caminho exato (ex.: /dashboard, que é prefixo das páginas novas). */
  exact?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Visão geral",
    items: [
      { label: "Resumo", href: "/dashboard/visao-geral" },
      { label: "Painel do Instagram", href: "/dashboard", exact: true },
    ],
  },
  {
    label: "Marketing",
    items: [
      { label: "Redes", href: "/dashboard/redes" },
      { label: "Palavras-chave", href: "/dashboard/palavras" },
      { label: "Campanhas", href: "/campaigns" },
      { label: "Caixa de entrada", href: "/inbox" },
      { label: "Registro de DMs", href: "/logs" },
      { label: "Calendário", href: "/dashboard/calendario" },
    ],
  },
  {
    label: "Financeiro",
    items: [{ label: "Financeiro", href: "/dashboard/financeiro" }],
  },
  {
    label: "Operações",
    items: [
      { label: "Automações", href: "/automations" },
      { label: "Diagnóstico", href: "/diagnostics" },
      { label: "API e MCP", href: "/integrations" },
      { label: "Seguidores", href: "/overview" },
      { label: "Configurações", href: "/settings" },
    ],
  },
  {
    label: "Equipe",
    items: [{ label: "Agentes", href: "/dashboard/agentes" }],
  },
];

export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(item.href + "/");
}

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
}

export default function Sidebar({
  isOpen,
  onClose,
  workspaceName,
}: SidebarProps) {
  const pathname = usePathname() ?? "";

  return (
    <>
      {/* Fundo escurecido no celular */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/60 lg:hidden"
          onClick={onClose}
        />
      )}

      <aside
        className={`
          fixed top-0 left-0 z-50 h-dvh w-64 max-w-[85vw] shrink-0 bg-surface border-r border-border flex flex-col
          transition-transform duration-200 ease-out
          lg:h-full lg:translate-x-0 lg:static lg:z-auto
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* A gaveta ocupa a altura toda; sem o recuo a marca ficaria sob a barra de status. */}
        <div
          className="px-6 py-5 border-b border-border"
          style={{ paddingTop: "calc(1.25rem + env(safe-area-inset-top))" }}
        >
          <Link
            href="/dashboard/visao-geral"
            onClick={onClose}
            className="flex items-center gap-3 text-foreground"
          >
            <span
              aria-hidden="true"
              className="block h-6 w-[54px] shrink-0 bg-foreground"
              style={{
                WebkitMaskImage: "url(/opi-logo.svg)",
                maskImage: "url(/opi-logo.svg)",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskPosition: "left center",
                maskPosition: "left center",
              }}
            />
            <span className="text-base font-semibold">OPI Central</span>
          </Link>
        </div>

        <nav
          aria-label="Navegação do painel"
          className="flex-1 px-3 py-4 space-y-5 overflow-y-auto"
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-1.5 text-xs font-medium uppercase tracking-wide text-muted">
                {group.label}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => {
                  const isActive = isNavItemActive(item, pathname);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={onClose}
                      aria-current={isActive ? "page" : undefined}
                      className={`
                        block px-3 py-2 rounded text-sm
                        ${
                          isActive
                            ? "bg-surface-hover text-foreground font-medium"
                            : "text-muted hover:text-foreground hover:bg-surface-hover"
                        }
                      `}
                    >
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="px-5 py-4 border-t border-border">
          <p className="text-sm text-foreground truncate">{workspaceName}</p>
          <p className="text-xs text-muted">OPI · Opções para Investidores</p>
          <a
            href={zernioLink({ placement: "sidebar" })}
            target="_blank"
            rel="sponsored noopener noreferrer"
            className="mt-3 inline-block text-xs text-muted hover:text-foreground"
          >
            Apoio: Zernio
          </a>
        </div>
      </aside>
    </>
  );
}
