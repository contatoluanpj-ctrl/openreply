"use client";

/**
 * Sidebar do OPI Central
 *
 * "Hoje", os 12 departamentos (cada um abre a sua página e as suas telas) e "Sistema".
 * O menu vem de lib/opi/departamentos.ts; as cores vêm só dos tokens de .opi-central.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import {
  DEPARTAMENTOS,
  MENU_HOJE,
  MENU_SISTEMA,
  departamentoDaRota,
  hrefDepartamento,
  itemAtivo,
  itensDoDepartamento,
} from "@/lib/opi/departamentos";
import type { TemaOpi } from "@/lib/opi/tema";
import { zernioLink } from "@/lib/zernio-links";

interface SidebarProps {
  isOpen: boolean;
  onClose: () => void;
  workspaceName: string;
  tema: TemaOpi;
  onTema: (tema: TemaOpi) => void;
  /** Rota a marcar no menu no lugar da rota do navegador (só a prévia local usa). */
  rotaAtual?: string;
}

/** Traço único de 16px por item: ajuda a achar o departamento sem ler a lista inteira. */
const ICONE: Record<string, ReactNode> = {
  hoje: <><circle cx="8" cy="8" r="2.6" /><path d="M8 1.6v1.8M8 12.6v1.8M1.6 8h1.8M12.6 8h1.8M3.5 3.5l1.2 1.2M11.3 11.3l1.2 1.2M12.5 3.5l-1.2 1.2M4.7 11.3l-1.2 1.2" /></>,
  comercial: <><path d="M2 12.5 6 8l2.6 2.4L14 4.5" /><path d="M10.4 4.5H14v3.6" /></>,
  marketing: <><path d="M2.5 6.5v3h2.2l5.3 3V3.5l-5.3 3H2.5Z" /><path d="M12.3 6.2a2.6 2.6 0 0 1 0 3.6" /></>,
  operacoes: <><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v2M8 12.2v2M2.6 4.9l1.8 1M11.6 10.1l1.8 1M2.6 11.1l1.8-1M11.6 5.9l1.8-1" /></>,
  financeiro: <><rect x="1.8" y="3.8" width="12.4" height="8.4" rx="1.6" /><circle cx="8" cy="8" r="1.9" /></>,
  dados: <path d="M2.5 13.5h11M4.5 11V7.5M8 11V3.5M11.5 11V6" />,
  produto: <><path d="M8 1.8 13.5 4.6v6.8L8 14.2 2.5 11.4V4.6L8 1.8Z" /><path d="M2.5 4.6 8 7.4l5.5-2.8M8 7.4v6.8" /></>,
  atendimentos: <path d="M2.2 3.4h11.6v7.4H7.2l-3 2.6v-2.6h-2V3.4Z" />,
  "rh-e-pessoas": <><circle cx="6" cy="5.4" r="2.3" /><path d="M1.8 13c.4-2.3 2-3.6 4.2-3.6s3.8 1.3 4.2 3.6" /><path d="M10.6 3.4a2.2 2.2 0 0 1 0 4.2M11.9 9.7c1.3.5 2.1 1.6 2.4 3.3" /></>,
  juridico: <><path d="M8 2v12M4.5 14h7M3 4.5h10" /><path d="M3 4.5 1.4 8.6a1.9 1.9 0 0 0 3.2 0L3 4.5ZM13 4.5l-1.6 4.1a1.9 1.9 0 0 0 3.2 0L13 4.5Z" /></>,
  tecnologia: <path d="m5.4 4.8-3.2 3.2 3.2 3.2M10.6 4.8l3.2 3.2-3.2 3.2M9 3 7 13" />,
  seguranca: <><path d="M8 1.8 13 3.6v4.1c0 3-2 5.2-5 6.5-3-1.3-5-3.5-5-6.5V3.6L8 1.8Z" /><path d="m5.9 8 1.5 1.5 2.8-3" /></>,
  pesquisa: <><circle cx="7" cy="7" r="4.2" /><path d="m10.2 10.2 3.4 3.4" /></>,
  "/dashboard/agentes": <><rect x="5.6" y="1.8" width="4.8" height="3.6" rx="1" /><rect x="1.6" y="10.6" width="4.8" height="3.6" rx="1" /><rect x="9.6" y="10.6" width="4.8" height="3.6" rx="1" /><path d="M8 5.4V8M4 10.6V8h8v2.6" /></>,
  "/dashboard/chat": <path d="M2.2 3h11.6v7.8H8.4l-3.2 2.8v-2.8h-3V3Z" />,
};

function Icone({ nome }: { nome: string }) {
  return (
    <svg
      viewBox="0 0 16 16"
      className="h-4 w-4 shrink-0"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {ICONE[nome]}
    </svg>
  );
}

const LINHA = "flex min-h-10 lg:min-h-9 min-w-0 flex-1 items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-semibold transition-colors";
const LINHA_ATIVA = "bg-accent-soft text-foreground shadow-[inset_2px_0_0_var(--color-accent)]";
const LINHA_PARADA = "text-muted hover:bg-surface-hover hover:text-foreground";
const ROTULO = "px-3 pb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint";

export default function Sidebar({ isOpen, onClose, workspaceName, tema, onTema, rotaAtual }: SidebarProps) {
  const rotaDoNavegador = usePathname() ?? "";
  const pathname = rotaAtual ?? rotaDoNavegador;
  const dono = departamentoDaRota(pathname)?.slug ?? null;
  // Aberto = o departamento da tela atual, mais o que o Luan abriu ou fechou à mão.
  const [manual, setManual] = useState<Record<string, boolean>>({});
  const aberto = (slug: string) => manual[slug] ?? slug === dono;

  return (
    <>
      {/* Fundo escurecido no celular */}
      {isOpen && <div className="fixed inset-0 z-40 bg-overlay lg:hidden" onClick={onClose} />}

      <aside
        className={`
          fixed top-0 left-0 z-50 h-dvh w-[272px] max-w-[85vw] shrink-0 flex flex-col
          bg-surface-strong border-r border-border
          transition-transform duration-200 ease-out
          lg:relative lg:m-4 lg:mr-0 lg:h-[calc(100%-2rem)] lg:w-[248px] lg:translate-x-0 lg:z-10
          lg:rounded-[24px] lg:border lg:bg-surface lg:backdrop-blur-xl
          ${isOpen ? "translate-x-0" : "-translate-x-full"}
        `}
      >
        {/* A gaveta ocupa a altura toda; sem o recuo a marca ficaria sob a barra de status. */}
        <div className="px-5 pb-3" style={{ paddingTop: "calc(1.25rem + env(safe-area-inset-top))" }}>
          <Link href="/dashboard" onClick={onClose} className="flex flex-col gap-2 text-foreground">
            <span
              aria-hidden="true"
              className="block h-8 w-[88px] shrink-0 bg-foreground"
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
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-faint">OPI Central</span>
          </Link>
        </div>

        <nav aria-label="Navegação do painel" className="flex-1 space-y-5 overflow-y-auto px-3 py-2">
          <div>
            <Link
              href={MENU_HOJE.href}
              onClick={onClose}
              aria-current={itemAtivo(MENU_HOJE, pathname) ? "page" : undefined}
              className={`${LINHA} ${itemAtivo(MENU_HOJE, pathname) ? LINHA_ATIVA : LINHA_PARADA}`}
            >
              <Icone nome="hoje" />
              {MENU_HOJE.label}
            </Link>
          </div>

          <div>
            <p className={ROTULO}>Departamentos</p>
            <ul className="space-y-0.5">
              {DEPARTAMENTOS.map((dep) => {
                const itens = itensDoDepartamento(dep);
                const href = hrefDepartamento(dep.slug);
                const naPagina = itemAtivo({ label: dep.nome, href }, pathname);
                const expandido = itens.length > 0 && aberto(dep.slug);
                const idLista = `menu-${dep.slug}`;
                return (
                  <li key={dep.slug}>
                    <div className="flex items-center gap-1">
                      <Link
                        href={href}
                        onClick={onClose}
                        aria-current={naPagina ? "page" : undefined}
                        className={`${LINHA} ${naPagina ? LINHA_ATIVA : dono === dep.slug ? "text-foreground hover:bg-surface-hover" : LINHA_PARADA}`}
                      >
                        <Icone nome={dep.slug} />
                        <span className="truncate">{dep.nome}</span>
                      </Link>
                      {itens.length > 0 && (
                        <button
                          type="button"
                          aria-expanded={expandido}
                          aria-controls={idLista}
                          aria-label={`${expandido ? "Fechar" : "Abrir"} as telas de ${dep.nome}`}
                          onClick={() => setManual((m) => ({ ...m, [dep.slug]: !expandido }))}
                          className="grid h-10 w-9 shrink-0 place-items-center rounded-xl text-faint lg:h-9 hover:bg-surface-hover hover:text-foreground"
                        >
                          <svg viewBox="0 0 16 16" className={`h-3.5 w-3.5 transition-transform ${expandido ? "rotate-90" : ""}`} fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                            <path d="m6 3.5 4.5 4.5L6 12.5" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {expandido && (
                      <ul id={idLista} className="mb-1.5 ml-[1.35rem] mt-0.5 space-y-0.5 border-l border-border pl-2">
                        {itens.map((item) => {
                          const ativo = itemAtivo(item, pathname);
                          return (
                            <li key={item.href}>
                              <Link
                                href={item.href}
                                onClick={onClose}
                                aria-current={ativo ? "page" : undefined}
                                className={`flex min-h-9 items-center rounded-lg px-2.5 py-1.5 text-[13px] font-medium transition-colors ${
                                  ativo ? "bg-accent-soft text-foreground" : "text-muted hover:bg-surface-hover hover:text-foreground"
                                }`}
                              >
                                {item.label}
                              </Link>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <div>
            <p className={ROTULO}>Sistema</p>
            <ul className="space-y-0.5">
              {MENU_SISTEMA.map((item) => {
                const ativo = itemAtivo(item, pathname);
                return (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      onClick={onClose}
                      aria-current={ativo ? "page" : undefined}
                      className={`${LINHA} ${ativo ? LINHA_ATIVA : LINHA_PARADA}`}
                    >
                      <Icone nome={item.href} />
                      {item.label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        </nav>

        <div className="mx-3 mb-3 border-t border-border px-2 pt-3 pb-1">
          <p className="truncate text-[13px] font-semibold text-foreground">{workspaceName}</p>
          <p className="text-xs text-muted">OPI · Opções para Investidores</p>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs text-muted" id="opi-tema-rotulo">Tema</span>
            <div className="opi-seg" role="group" aria-labelledby="opi-tema-rotulo">
              <button type="button" aria-pressed={tema === "a"} onClick={() => onTema("a")}>A · preto</button>
              <button type="button" aria-pressed={tema === "b"} onClick={() => onTema("b")}>B · grafite</button>
            </div>
          </div>
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
