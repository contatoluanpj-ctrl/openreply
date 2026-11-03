import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CHAVES,
  FRASE_RESPOSTA_PUBLICA,
  TEXTOS_DM_APROVADOS,
  foraDaJanela,
  hashTemplate,
  mascararTexto,
  motivoCampanhaNaoConforme,
  omitirTexto,
  respostasPublicasPermitidas,
  mensagemSemCampanha,
  JEV_TENTATIVAS,
  LIMIARES,
  PERGUNTAS,
  TYPESAFE_URL,
  avaliarComentario,
  avisarTelegram,
  casarPalavra,
  corpoJev,
  decidirJev,
  gateLigado,
  hashEntrada,
  linhasLedger,
  mensagemTelegram,
  paraLinhaJsonl,
  pausaPrimeiraDmLigada,
  reservarPrimeiraDm,
  resolverCaso,
  type FetchLike,
} from "@/lib/opi/jev-gate";

const KW = ["JUROS", "ERROS", "PROTEÇÃO", "ESTRATÉGIAS"];

// Resposta do TypeSafe com tudo "limpo"; o teste sobrescreve só o que importa.
function jevOk(p: Partial<Record<string, number>> = {}) {
  const base: Record<string, number> = { so_palavra: 0.95, pede_orientacao: 0.01, avalia_operacao: 0.01, reclamacao_legal: 0.01, dado_pessoal: 0.01, ...p } as Record<string, number>;
  return { statusCode: 200, body: { answers: Object.fromEntries(Object.entries(base).map(([k, v]) => [k, { noul: v }])) } };
}

function fetchSequencia(respostas: Array<{ status: number; body?: unknown } | Error>) {
  const calls: Array<{ url: string; init: Parameters<FetchLike>[1] }> = [];
  let i = 0;
  const fn: FetchLike = async (url, init) => {
    calls.push({ url, init });
    const r = respostas[Math.min(i++, respostas.length - 1)];
    if (r instanceof Error) throw r;
    return { status: r.status, json: async () => (r.body === undefined ? Promise.reject(new Error("sem json")) : r.body) };
  };
  return { fn, calls };
}

const semEspera = async () => {};

describe("casarPalavra", () => {
  it("tolera caixa, acento, pontuação, emoji e cortesia", () => {
    for (const t of ["JUROS", "juros", " Juros! ", "juros 🙏", "#juros", "JUROS JUROS", "Quero JUROS por favor", "juros, obrigado!"]) {
      const m = casarPalavra(t, KW);
      expect([m.palavra, m.essencial], t).toEqual(["JUROS", true]);
    }
    expect(casarPalavra("Proteção", KW)).toMatchObject({ palavra: "PROTEÇÃO", essencial: true });
    expect(casarPalavra("PROTECAO", KW)).toMatchObject({ palavra: "PROTEÇÃO", essencial: true });
    expect(casarPalavra("estratégias", KW)).toMatchObject({ palavra: "ESTRATÉGIAS", essencial: true });
  });

  it("texto além da palavra, 2 palavras-chave ou mais de 8 tokens = triagem", () => {
    for (const t of ["juros, mas e o CDI?", "JUROS @amigo", "quero juros e comprar PETR4", "JUROS ERROS", "juros juros juros juros juros juros juros juros juros"]) {
      const m = casarPalavra(t, KW);
      expect(m.palavra, t).toBeTruthy();
      expect(m.essencial, t).toBe(false);
    }
    expect(casarPalavra("JUROS ERROS", KW).motivo).toBe("mais de uma palavra-chave");
    expect(casarPalavra("juros adorei o vídeo", KW).motivo).toBe("texto além da palavra-chave");
  });

  it("sem palavra-chave isolada não casa", () => {
    for (const t of ["", "Ótimo vídeo", "juro", "jurosss", "errou"]) expect(casarPalavra(t, KW).palavra, t).toBeNull();
  });

  it("palavra-chave de várias palavras e grafias repetidas na campanha", () => {
    expect(casarPalavra("quero o guia completo!", ["guia completo"])).toMatchObject({ palavra: "guia completo", essencial: true });
    expect(casarPalavra("juros", ["JUROS", "juros"])).toMatchObject({ essencial: true });
  });
});

describe("corpoJev", () => {
  it("monta o corpo do System One com as 5 perguntas noul", () => {
    const c = corpoJev("JUROS", "x".repeat(900));
    expect(c.model).toBe("jev-latest");
    expect(c.state.palavra_chave).toBe("JUROS");
    expect(c.state.comentario).toHaveLength(500);
    expect(Object.keys(c.questions).sort()).toEqual([...CHAVES].sort());
    for (const k of CHAVES) expect(c.questions[k]).toEqual({ type: "noul", instructions: PERGUNTAS[k].instructions });
    expect(PERGUNTAS.so_palavra.id).toBe("opi.dm.so_palavra");
  });
});

describe("decidirJev nos limiares (bordas exatas)", () => {
  it("segue o PARECER §3.3", () => {
    expect(LIMIARES).toEqual({ so_palavra: 0.8, pede_orientacao: 0.1, avalia_operacao: 0.1, reclamacao_legal: 0.05, dado_pessoal: 0.05 });
    const d = (p: Partial<Record<string, number>>) => decidirJev(jevOk(p).body).decisao;
    expect(d({})).toBe("enviar");
    expect(d({ so_palavra: 0.8 })).toBe("enviar");
    expect(d({ so_palavra: 0.7999 })).toBe("manual_revisao");
    expect(d({ pede_orientacao: 0.0999 })).toBe("enviar");
    expect(d({ pede_orientacao: 0.1 })).toBe("luan");
    expect(d({ avalia_operacao: 0.0999 })).toBe("enviar");
    expect(d({ avalia_operacao: 0.1 })).toBe("luan");
    expect(d({ reclamacao_legal: 0.0499 })).toBe("enviar");
    expect(d({ reclamacao_legal: 0.05 })).toBe("compliance");
    expect(d({ dado_pessoal: 0.0499 })).toBe("enviar");
    expect(d({ dado_pessoal: 0.05 })).toBe("compliance");
    expect(d({ dado_pessoal: 0.05, pede_orientacao: 0.9, so_palavra: 0.1 })).toBe("compliance");
    expect(d({ pede_orientacao: 0.5, so_palavra: 0.1 })).toBe("luan");
  });

  it("resposta incompleta ou p inválido = manual_jev_falhou", () => {
    const ok = jevOk().body.answers;
    for (const ruim of [null, {}, { answers: {} }, { answers: { so_palavra: { noul: 0.99 } } },
      { answers: { ...ok, dado_pessoal: { noul: "x" } } }, { answers: { ...ok, so_palavra: { noul: NaN } } },
      { answers: { ...ok, so_palavra: { noul: 1.5 } } }, { answers: { ...ok, so_palavra: { noul: -0.1 } } }]) {
      expect(decidirJev(ruim).decisao, JSON.stringify(ruim)).toBe("manual_jev_falhou");
    }
  });
});

describe("resolverCaso", () => {
  it("falha passageira volta até 3 tentativas; 4xx e incompleta vão direto à revisão", () => {
    expect(JEV_TENTATIVAS).toBe(3);
    const caso = (tentativa: number) => ({ soTriagem: false, tentativa });
    for (const r of [null, { error: "timeout" }, { statusCode: 500, body: {} }, { statusCode: 503, body: {} }, { statusCode: 429, body: {} }]) {
      expect(resolverCaso(caso(1), r).decisao).toBe("jev_indisponivel");
      expect(resolverCaso(caso(2), r).decisao).toBe("jev_indisponivel");
      expect(resolverCaso(caso(3), r).decisao).toBe("manual_jev_falhou");
    }
    for (const r of [{ statusCode: 401, body: {} }, { statusCode: 400, body: { error: "x" } }, { statusCode: 200, body: { answers: {} } }]) {
      expect(resolverCaso(caso(1), r).decisao).toBe("manual_jev_falhou");
    }
    expect(resolverCaso(caso(1), jevOk()).decisao).toBe("enviar");
  });

  it("triagem nunca envia, mesmo com so_palavra alto", () => {
    const tri = { soTriagem: true, motivoTriagem: "texto além da palavra-chave", tentativa: 1 };
    for (const p of [{ so_palavra: 0.99 }, { so_palavra: 0.9 }, { so_palavra: 0.2 }]) {
      expect(resolverCaso(tri, jevOk(p)).decisao).toBe("manual_texto_extra");
    }
    expect(resolverCaso(tri, jevOk({ reclamacao_legal: 0.3 })).decisao).toBe("compliance");
    expect(resolverCaso(tri, jevOk({ dado_pessoal: 0.05 })).decisao).toBe("compliance");
    expect(resolverCaso(tri, jevOk({ pede_orientacao: 0.4 })).decisao).toBe("luan");
    const f = resolverCaso(tri, { error: "timeout" });
    expect(f.decisao).toBe("manual_texto_extra");
    expect(f.motivo).toMatch(/Compliance/);
  });
});

describe("avaliarComentario (fail-closed)", () => {
  it("envia só com Jev OK e comentário essencial; usa POST com Bearer", async () => {
    const { fn, calls } = fetchSequencia([{ status: 200, body: jevOk().body }]);
    const a = await avaliarComentario({ texto: "JUROS 🙏", palavrasChave: KW, apiKey: "chave-teste", fetchImpl: fn, sleep: semEspera });
    expect(a.decisao).toBe("enviar");
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(TYPESAFE_URL);
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers.Authorization).toBe("Bearer chave-teste");
    expect(JSON.parse(calls[0].init.body).model).toBe("jev-latest");
  });

  it("sem TYPESAFE_API_KEY: não chama o Jev e não envia", async () => {
    const { fn, calls } = fetchSequencia([{ status: 200, body: jevOk().body }]);
    for (const apiKey of [undefined, "", "   "]) {
      const a = await avaliarComentario({ texto: "JUROS", palavrasChave: KW, apiKey, fetchImpl: fn, sleep: semEspera });
      expect(a.decisao).toBe("manual_jev_falhou");
      expect(a.tentativas).toBe(0);
    }
    expect(calls).toHaveLength(0);
  });

  it("500 e 429 repetidos: 3 tentativas e depois revisão manual", async () => {
    for (const status of [500, 429]) {
      const sleep = vi.fn(semEspera);
      const { fn, calls } = fetchSequencia([{ status, body: {} }]);
      const a = await avaliarComentario({ texto: "JUROS", palavrasChave: KW, apiKey: "k", fetchImpl: fn, sleep });
      expect(a.decisao).toBe("manual_jev_falhou");
      expect(calls).toHaveLength(3);
      expect(sleep).toHaveBeenCalledTimes(2);
      expect(a.tentativas).toBe(3);
    }
  });

  it("erro de rede seguido de sucesso: envia na 2ª tentativa", async () => {
    const { fn, calls } = fetchSequencia([new Error("ECONNRESET"), { status: 200, body: jevOk().body }]);
    const a = await avaliarComentario({ texto: "juros", palavrasChave: KW, apiKey: "k", fetchImpl: fn, sleep: semEspera });
    expect(a.decisao).toBe("enviar");
    expect(calls).toHaveLength(2);
  });

  it("resposta incompleta ou corpo não-JSON: revisão sem nova tentativa", async () => {
    for (const r of [{ status: 200, body: { answers: { so_palavra: { noul: 0.99 } } } }, { status: 200 }]) {
      const { fn, calls } = fetchSequencia([r]);
      const a = await avaliarComentario({ texto: "JUROS", palavrasChave: KW, apiKey: "k", fetchImpl: fn, sleep: semEspera });
      expect(a.decisao).toBe("manual_jev_falhou");
      expect(calls).toHaveLength(1);
    }
  });

  it("triagem nunca envia, mesmo com o Jev dizendo so_palavra 0,99", async () => {
    const { fn } = fetchSequencia([{ status: 200, body: jevOk({ so_palavra: 0.99 }).body }]);
    const a = await avaliarComentario({ texto: "JUROS adorei o vídeo", palavrasChave: KW, apiKey: "k", fetchImpl: fn, sleep: semEspera });
    expect(a.soTriagem).toBe(true);
    expect(a.decisao).toBe("manual_texto_extra");
  });

  it("campanha matchAnyWord passa pelo filtro: sem palavra-chave nunca envia", async () => {
    const { fn, calls } = fetchSequencia([{ status: 200, body: jevOk({ so_palavra: 0.99 }).body }]);
    const a = await avaliarComentario({ texto: "que vídeo bom", palavrasChave: [], matchAnyWord: true, apiKey: "k", fetchImpl: fn, sleep: semEspera });
    expect(a.decisao).toBe("manual_texto_extra");
    expect(a.motivo).toMatch(/qualquer palavra/);
    expect(calls).toHaveLength(1);
    // matchAnyWord com palavras-chave cadastradas: só a palavra isolada pode receber DM.
    const { fn: fn2 } = fetchSequencia([{ status: 200, body: jevOk().body }]);
    const b = await avaliarComentario({ texto: "JUROS!", palavrasChave: KW, matchAnyWord: true, apiKey: "k", fetchImpl: fn2, sleep: semEspera });
    expect(b.decisao).toBe("enviar");
  });
});

describe("ledger e aviso", () => {
  it("uma linha por pergunta por chamada, sem o texto do comentário", async () => {
    const { fn } = fetchSequencia([{ status: 500, body: {} }]);
    const a = await avaliarComentario({ texto: "JUROS", palavrasChave: KW, apiKey: "k", fetchImpl: fn, sleep: semEspera });
    const ls = linhasLedger(a, { workspaceId: "w", automationId: "a", commentId: "c", texto: "JUROS" });
    expect(ls).toHaveLength(5);
    expect(ls.map((l) => l.pergunta)).toEqual(CHAVES.map((k) => PERGUNTAS[k].id));
    expect(ls.every((l) => l.p === null && l.erro && l.decisao === "manual_jev_falhou")).toBe(true);
    expect(ls[0].entradaHash).toBe(hashEntrada("JUROS", "JUROS"));
    const j = paraLinhaJsonl({ ...ls[0], id: "row1", createdAt: new Date("2026-11-02T12:00:00Z"), finalLuan: null, resultadoReal: null });
    expect(Object.keys(j)).toEqual(["id", "data", "processo", "pergunta", "versao", "ref", "entrada", "p", "erro", "final_luan", "resultado_real", "sessao"]);
    expect(j).toMatchObject({ processo: "openreply.dm", sessao: "OpenReply", ref: "ig_comment:c", p: null, data: "2026-11-02T12:00:00.000Z" });
    expect(j.id).toHaveLength(12);
    expect(JSON.stringify(j)).not.toContain("JUROS\"");
  });

  it("mensagem do Telegram trunca o comentário em 200 caracteres", () => {
    const m = mensagemTelegram({ campanha: "Juros", usuario: "fulano", texto: "a".repeat(300), decisao: "luan", motivo: "x", origem: "comentário" });
    expect(m).toContain("@fulano");
    expect(m).toContain("a".repeat(200) + "…");
    expect(m).not.toContain("a".repeat(201));
    const c = mensagemTelegram({ campanha: "Juros", usuario: "fulano", texto: "segredo", decisao: "compliance", motivo: "x", origem: "comentário", commentId: "c9" });
    expect(c).toContain("Compliance");
    expect(c).not.toContain("segredo");
    expect(c).toContain("c9");
  });

  it("Telegram: sem variáveis não chama; erro nunca lança", async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200 }));
    expect(await avisarTelegram("oi", {}, f)).toBe(false);
    expect(f).not.toHaveBeenCalled();
    const env = { OPI_TELEGRAM_BOT_TOKEN: "t", OPI_TELEGRAM_CHAT_ID: "1" };
    expect(await avisarTelegram("oi", env, f)).toBe(true);
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await avisarTelegram("oi", env, async () => { throw new Error("boom"); })).toBe(false);
    expect(await avisarTelegram("oi", env, async () => ({ ok: false, status: 502 }))).toBe(false);
    expect(err.mock.calls.flat().join(" ")).not.toContain("t/sendMessage");
    err.mockRestore();
  });
});

describe("interruptores", () => {
  it("OPI_JEV_GATE ligado por padrão; só 'off' (e sinônimos) desliga", () => {
    expect(gateLigado({})).toBe(true);
    expect(gateLigado({ OPI_JEV_GATE: "on" })).toBe(true);
    expect(gateLigado({ OPI_JEV_GATE: "off" })).toBe(false);
    expect(gateLigado({ OPI_JEV_GATE: "OFF" })).toBe(false);
    expect(pausaPrimeiraDmLigada({})).toBe(true);
    expect(pausaPrimeiraDmLigada({ OPI_PAUSE_AFTER_FIRST_DM: "true" })).toBe(true);
    expect(pausaPrimeiraDmLigada({ OPI_PAUSE_AFTER_FIRST_DM: "false" })).toBe(false);
    expect(pausaPrimeiraDmLigada({ OPI_JEV_GATE: "off" })).toBe(false);
  });
});

describe("pausa da 1ª DM (reservarPrimeiraDm)", () => {
  function db(estado: { ativa: boolean; enviados: number }) {
    return {
      automation: {
        count: vi.fn(async () => (estado.ativa ? 1 : 0)),
        updateMany: vi.fn(async () => {
          if (!estado.ativa) return { count: 0 };
          estado.ativa = false;
          return { count: 1 };
        }),
      },
      dmLog: { count: vi.fn(async () => estado.enviados) },
    };
  }

  it("1ª DM: desativa a campanha de forma atômica e libera só esta", async () => {
    const estado = { ativa: true, enviados: 0 };
    const d = db(estado);
    expect(await reservarPrimeiraDm(d, "a1")).toBe("primeira");
    expect(d.automation.updateMany).toHaveBeenCalledWith({ where: { id: "a1", isActive: true }, data: { isActive: false } });
    expect(estado.ativa).toBe(false);
    // A seguinte (mesmo que já houvesse lido a campanha ativa antes) não sai.
    expect(await reservarPrimeiraDm(d, "a1")).toBe("pausada");
  });

  it("corrida: dois jobs veem 0 enviados, só um ganha o updateMany", async () => {
    const estado = { ativa: true, enviados: 0 };
    const d = db(estado);
    d.automation.count.mockResolvedValue(1); // os dois leram a campanha ativa
    const r = await Promise.all([reservarPrimeiraDm(d, "a1"), reservarPrimeiraDm(d, "a1")]);
    expect(r.sort()).toEqual(["pausada", "primeira"]);
  });

  it("depois de reativada e com DM enviada, segue normal", async () => {
    const d = db({ ativa: true, enviados: 1 });
    expect(await reservarPrimeiraDm(d, "a1")).toBe("normal");
    expect(d.automation.updateMany).not.toHaveBeenCalled();
  });
});

describe("resposta pública permitida", () => {
  it("só a frase aprovada passa com o portão ligado", () => {
    expect(FRASE_RESPOSTA_PUBLICA).toBe("Te mandei na DM! 📩");
    expect(respostasPublicasPermitidas(["Te mandei na DM! 📩"], {})).toEqual(["Te mandei na DM! 📩"]);
    expect(respostasPublicasPermitidas(["  Te mandei na DM! 📩 ", "outra"], {})).toEqual(["Te mandei na DM! 📩"]);
    expect(respostasPublicasPermitidas(["Te mandei na DM!"], {})).toEqual([]);
    expect(respostasPublicasPermitidas(["Te mandei na DM, {username}! 📩"], {})).toEqual([]);
    expect(respostasPublicasPermitidas([], {})).toEqual([]);
  });
  it("portão desligado mantém o pool original", () => {
    expect(respostasPublicasPermitidas(["qualquer"], { OPI_JEV_GATE: "off" })).toEqual(["qualquer"]);
  });
  it("aviso de sem campanha corta o texto em 200 caracteres", () => {
    const m = mensagemSemCampanha({ usuario: null, texto: "a".repeat(300), midia: "m1" });
    expect(m).toContain("@desconhecido");
    expect(m).toContain("a".repeat(200) + "…");
    expect(m).not.toContain("a".repeat(201));
  });
});

describe("achados do fiscal: texto aprovado, janela, máscara", () => {
  it("os textos aprovados são os mesmos dos arquivos de campanha (fases A e B)", () => {
    const doArquivo = ["a", "b"].flatMap((f) =>
      JSON.parse(readFileSync(join(__dirname, "..", "docs", "opi", `campanhas-fase-${f}.json`), "utf8")).campaigns.map((c: { dmMessage: string }) => c.dmMessage));
    expect(new Set(doArquivo.map(hashTemplate))).toEqual(new Set(TEXTOS_DM_APROVADOS.map(hashTemplate)));
    for (const t of TEXTOS_DM_APROVADOS) expect(t.endsWith("Conteúdo educativo. Não é recomendação individual de investimento.")).toBe(true);
  });

  it("campanha conforme só com texto aprovado, da própria palavra, presa a um Reel e sem extras", () => {
    const ok = { dmMessage: TEXTOS_DM_APROVADOS[1], keywords: ["ERROS"], postId: "m1" };
    expect(motivoCampanhaNaoConforme(ok)).toBeNull();
    expect(motivoCampanhaNaoConforme({ ...ok, keywords: ["erros"] })).toBeNull();
    expect(motivoCampanhaNaoConforme({ ...ok, dmMessage: TEXTOS_DM_APROVADOS[1].replace(/\n/g, "\r\n") })).toBeNull();
    expect(motivoCampanhaNaoConforme({ ...ok, dmMessage: TEXTOS_DM_APROVADOS[1] + " " + "!" })).toMatch(/texto/);
    expect(motivoCampanhaNaoConforme({ ...ok, keywords: ["JUROS"] })).toMatch(/palavra-chave/);
    expect(motivoCampanhaNaoConforme({ ...ok, keywords: ["TERMOS"] })).toMatch(/palavra-chave/);
    expect(motivoCampanhaNaoConforme({ ...ok, keywords: ["ERROS", "ERRO"] })).toMatch(/palavra-chave/);
    expect(motivoCampanhaNaoConforme({ dmMessage: TEXTOS_DM_APROVADOS[1], postId: "m1" })).toMatch(/palavra-chave/);
    expect(motivoCampanhaNaoConforme({ ...ok, matchAnyWord: true })).toMatch(/qualquer palavra/);
    expect(motivoCampanhaNaoConforme({ ...ok, matchAnyPost: true })).toMatch(/Reel/);
    expect(motivoCampanhaNaoConforme({ ...ok, pendingNextReel: true })).toMatch(/Reel/);
    expect(motivoCampanhaNaoConforme({ ...ok, postId: null })).toMatch(/Reel/);
    expect(motivoCampanhaNaoConforme({ ...ok, trackedLinks: [{}] })).toMatch(/link/);
    expect(motivoCampanhaNaoConforme({ ...ok, openingDmEnabled: true })).toMatch(/abertura/);
    expect(motivoCampanhaNaoConforme({ ...ok, requireFollow: true })).toMatch(/seguir/);
    expect(motivoCampanhaNaoConforme({ ...ok, followUpEnabled: true })).toMatch(/follow-up/);
    expect(motivoCampanhaNaoConforme({ ...ok, dmTriggerEnabled: true })).toMatch(/gatilho/);
  });

  it("janela de 7 dias", () => {
    const agora = new Date("2026-11-10T12:00:00Z");
    expect(foraDaJanela(null, agora)).toBe(false);
    expect(foraDaJanela("2026-11-03T12:00:01Z", agora)).toBe(false);
    expect(foraDaJanela("2026-11-03T11:59:59Z", agora)).toBe(true);
    expect(foraDaJanela("lixo", agora)).toBe(false);
  });

  it("máscara de dado pessoal e omissão do texto", () => {
    expect(mascararTexto("cpf 123.456.789-00 e ana@x.com, ver https://a.b/c")).toBe("cpf [número] e [e-mail], ver [link]");
    expect(mascararTexto("tenho 2 dúvidas sobre 30 dias")).toBe("tenho 2 dúvidas sobre 30 dias");
    expect(omitirTexto("compliance", null)).toBe(true);
    expect(omitirTexto("luan", { dado_pessoal: 0.05 })).toBe(true);
    expect(omitirTexto("luan", { dado_pessoal: 0.04 })).toBe(false);
  });

  it("Telegram: 429 ganha uma nova tentativa", async () => {
    const f = vi.fn().mockResolvedValueOnce({ ok: false, status: 429 }).mockResolvedValueOnce({ ok: true, status: 200 });
    const env = { OPI_TELEGRAM_BOT_TOKEN: "t", OPI_TELEGRAM_CHAT_ID: "1" };
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await avisarTelegram("oi", env, f, async () => {})).toBe(true);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("pausa da 1ª DM conta só envios do mesmo texto", async () => {
    const count = vi.fn(async () => 0);
    const d = { automation: { count: vi.fn(async () => 1), updateMany: vi.fn(async () => ({ count: 1 })) }, dmLog: { count } };
    expect(await reservarPrimeiraDm(d, "a1", "h1")).toBe("primeira");
    expect(count).toHaveBeenCalledWith({ where: { automationId: "a1", status: "SENT", dmTemplateHash: "h1" } });
  });
});
