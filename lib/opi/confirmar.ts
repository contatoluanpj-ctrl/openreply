"use client";

/**
 * Confirmação dentro da página. Substitui window.confirm, que o navegador embutido do app
 * (e alguns navegadores em modo app) bloqueia e responde "não" sozinho — por isso "Apagar" não ia.
 */
export function confirmar(mensagem: string, rotuloOk = "Confirmar"): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const fundo = document.createElement("div");
    fundo.setAttribute("role", "dialog");
    fundo.setAttribute("aria-modal", "true");
    fundo.className = "opi-confirm";
    const caixa = document.createElement("div");
    caixa.className = "opi-confirm-box";
    const texto = document.createElement("p");
    texto.textContent = mensagem;
    const acoes = document.createElement("div");
    acoes.className = "opi-confirm-acoes";
    const cancelar = document.createElement("button");
    cancelar.type = "button";
    cancelar.textContent = "Cancelar";
    cancelar.className = "opi-confirm-cancelar";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = rotuloOk;
    ok.className = "opi-confirm-ok";
    acoes.append(cancelar, ok);
    caixa.append(texto, acoes);
    fundo.append(caixa);
    const fim = (v: boolean) => {
      document.removeEventListener("keydown", tecla);
      fundo.remove();
      resolve(v);
    };
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") fim(false);
      if (e.key === "Enter") fim(true);
    };
    cancelar.onclick = () => fim(false);
    ok.onclick = () => fim(true);
    fundo.onclick = (e) => { if (e.target === fundo) fim(false); };
    document.addEventListener("keydown", tecla);
    (document.querySelector(".opi-central") ?? document.body).append(fundo);
    ok.focus();
  });
}
