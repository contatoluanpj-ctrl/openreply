import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { C_LEVELS } from "@/lib/opi/agentes";
import {
  DEPARTAMENTOS,
  MENU_HOJE,
  MENU_SISTEMA,
  departamentoDaRota,
  departamentoPorSlug,
  hrefDepartamento,
  itemAtivo,
  itensDoDepartamento,
} from "@/lib/opi/departamentos";

const telas = (slug: string) => departamentoPorSlug(slug)!.ferramentas.map((f) => f.label);

/** Caminho do arquivo da página no grupo (dashboard) para um href do menu. */
function arquivoDaRota(href: string): string {
  return path.resolve(__dirname, "..", "app", "(dashboard)", ...href.split("/").filter(Boolean), "page.tsx");
}

describe("menu por departamento", () => {
  it("tem Hoje, os 12 departamentos na ordem do Luan e Sistema", () => {
    expect(MENU_HOJE).toEqual({ label: "Hoje", href: "/dashboard", exact: true });
    expect(DEPARTAMENTOS.map((d) => d.nome)).toEqual([
      "Comercial",
      "Marketing",
      "Operações",
      "Financeiro",
      "Dados",
      "Produto",
      "Atendimentos",
      "RH e Pessoas",
      "Jurídico",
      "Tecnologia",
      "Segurança",
      "Pesquisa",
    ]);
    expect(MENU_SISTEMA.map((i) => i.label)).toEqual(["Agentes", "Chat central"]);
  });

  it("slugs são únicos, sem acento nem espaço, e viram a rota do departamento", () => {
    const slugs = DEPARTAMENTOS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(12);
    for (const s of slugs) expect(s).toMatch(/^[a-z]+(-[a-z]+)*$/);
    expect(hrefDepartamento("rh-e-pessoas")).toBe("/dashboard/departamento/rh-e-pessoas");
    expect(departamentoPorSlug("nao-existe")).toBeUndefined();
  });

  it("realoca as telas atuais sem trocar o nome delas", () => {
    expect(telas("marketing")).toEqual(["Redes", "Calendário", "Conteúdo", "Palavras-chave", "Campanhas", "Seguidores"]);
    expect(telas("comercial")).toEqual(["Leads e funil"]);
    expect(telas("atendimentos")).toEqual(["Caixa de entrada", "Registro de DMs"]);
    expect(telas("tecnologia")).toEqual(["Diagnóstico", "Configurações", "Integrações"]);
    expect(telas("financeiro")).toEqual(["Financeiro"]);
  });

  it("todo diretor existe no catálogo de agentes", () => {
    const ids = new Set(C_LEVELS.map((c) => c.id));
    for (const d of DEPARTAMENTOS) expect(ids.has(d.diretorId), d.slug).toBe(true);
  });

  it("as rotas antigas continuam no menu e as páginas continuam existindo", () => {
    const antigas = [
      "/dashboard",
      "/dashboard/chat",
      "/dashboard/redes",
      "/dashboard/palavras",
      "/campaigns",
      "/dashboard/leads",
      "/dashboard/conteudo",
      "/inbox",
      "/logs",
      "/dashboard/calendario",
      "/dashboard/financeiro",
      "/diagnostics",
      "/overview",
      "/settings",
      "/dashboard/agentes",
    ];
    const noMenu = new Set([
      MENU_HOJE.href,
      ...MENU_SISTEMA.map((i) => i.href),
      ...DEPARTAMENTOS.flatMap((d) => d.ferramentas.map((f) => f.href)),
    ]);
    for (const href of antigas) {
      expect(noMenu.has(href), `${href} sumiu do menu`).toBe(true);
      expect(existsSync(arquivoDaRota(href)), `${href} sem página`).toBe(true);
    }
  });

  it("todo link do menu aponta para uma página que existe", () => {
    const hrefs = [
      MENU_HOJE.href,
      ...MENU_SISTEMA.map((i) => i.href),
      ...DEPARTAMENTOS.flatMap((d) => itensDoDepartamento(d).map((f) => f.href)),
    ];
    for (const href of hrefs) expect(existsSync(arquivoDaRota(href)), `${href} sem página`).toBe(true);
    expect(existsSync(arquivoDaRota("/dashboard/departamento/[slug]"))).toBe(true);
  });

  it("cada tela tem um único departamento dono", () => {
    const hrefs = DEPARTAMENTOS.flatMap((d) => d.ferramentas.map((f) => f.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("atalho só aponta para tela que já existe no menu e não repete tela do próprio departamento", () => {
    const conhecidas = new Set([
      MENU_HOJE.href,
      ...MENU_SISTEMA.map((i) => i.href),
      ...DEPARTAMENTOS.flatMap((d) => d.ferramentas.map((f) => f.href)),
    ]);
    for (const d of DEPARTAMENTOS) {
      for (const a of d.atalhos ?? []) {
        expect(conhecidas.has(a.href), `${d.slug}: ${a.href}`).toBe(true);
        expect(d.ferramentas.some((f) => f.href === a.href)).toBe(false);
      }
    }
  });

  it("tela planejada não vira link (Ideias e Produtos e anúncios ainda não existem)", () => {
    expect(departamentoPorSlug("marketing")!.planejadas).toEqual(["Ideias"]);
    expect(departamentoPorSlug("comercial")!.planejadas).toEqual(["Produtos e anúncios"]);
    const rotulos = DEPARTAMENTOS.flatMap((d) => itensDoDepartamento(d).map((f) => f.label));
    expect(rotulos).not.toContain("Ideias");
    expect(rotulos).not.toContain("Produtos e anúncios");
  });

  it("departamento sem tela fica com a lista vazia, sem item inventado", () => {
    for (const slug of ["operacoes", "produto", "juridico", "seguranca", "pesquisa"]) {
      expect(itensDoDepartamento(departamentoPorSlug(slug)!), slug).toEqual([]);
    }
  });
});

describe("itemAtivo", () => {
  it("Hoje só fica ativo no caminho exato", () => {
    expect(itemAtivo(MENU_HOJE, "/dashboard")).toBe(true);
    expect(itemAtivo(MENU_HOJE, "/dashboard/redes")).toBe(false);
  });

  it("tela fica ativa nela e nas subpáginas, não em rota de nome parecido", () => {
    const campanhas = { label: "Campanhas", href: "/campaigns" };
    expect(itemAtivo(campanhas, "/campaigns")).toBe(true);
    expect(itemAtivo(campanhas, "/campaigns/abc/edit")).toBe(true);
    expect(itemAtivo(campanhas, "/campaigns-old")).toBe(false);
  });
});

describe("departamentoDaRota", () => {
  it("acha o dono pela tela e pela página do departamento", () => {
    expect(departamentoDaRota("/dashboard/calendario")?.slug).toBe("marketing");
    expect(departamentoDaRota("/campaigns/abc/edit")?.slug).toBe("marketing");
    expect(departamentoDaRota("/dashboard/leads")?.slug).toBe("comercial");
    expect(departamentoDaRota("/logs")?.slug).toBe("atendimentos");
    expect(departamentoDaRota("/diagnostics")?.slug).toBe("tecnologia");
    expect(departamentoDaRota("/dashboard/departamento/dados")?.slug).toBe("dados");
    expect(departamentoDaRota("/dashboard/calendario?mes=2026-11#topo")?.slug).toBe("marketing");
  });

  it("atalho não muda o dono: Seguidores continua do Marketing mesmo aparecendo em Dados", () => {
    expect(departamentoPorSlug("dados")!.atalhos!.some((a) => a.href === "/overview")).toBe(true);
    expect(departamentoDaRota("/overview")?.slug).toBe("marketing");
  });

  it("Hoje, Agentes e Chat central não pertencem a departamento", () => {
    expect(departamentoDaRota("/dashboard")).toBeNull();
    expect(departamentoDaRota("/dashboard/agentes")).toBeNull();
    expect(departamentoDaRota("/dashboard/chat")).toBeNull();
  });
});
