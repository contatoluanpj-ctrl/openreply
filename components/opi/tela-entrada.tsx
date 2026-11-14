// Moldura das telas de entrada (/login e /verify-request) no tema do OPI Central: mesmo contêiner
// .opi-central do painel, com a variante escolhida (cookie) e o seletor de idioma dentro do tema.
import { cookies } from "next/headers";
import type { ReactNode } from "react";
import LanguageSwitcher from "@/components/language-switcher";
import { COOKIE_TEMA, lerTema } from "@/lib/opi/tema";

export async function TelaEntrada({ subtitulo, children }: { subtitulo?: ReactNode; children: ReactNode }) {
  const tema = lerTema((await cookies()).get(COOKIE_TEMA)?.value);
  return (
    <div data-tema={tema} className="opi-central flex min-h-dvh flex-col overflow-hidden">
      <div className="opi-aura" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      <div className="relative z-10 flex justify-end px-4 pt-4 sm:px-6">
        <LanguageSwitcher />
      </div>
      <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-8 sm:px-6">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center">
            <span
              aria-hidden="true"
              className="mx-auto mb-4 block h-10 w-[110px] bg-foreground"
              style={{
                WebkitMaskImage: "url(/opi-logo.svg)",
                maskImage: "url(/opi-logo.svg)",
                WebkitMaskRepeat: "no-repeat",
                maskRepeat: "no-repeat",
                WebkitMaskSize: "contain",
                maskSize: "contain",
                WebkitMaskPosition: "center",
                maskPosition: "center",
              }}
            />
            <h1 className="font-display text-2xl font-extrabold text-foreground">OPI Central</h1>
            {subtitulo && <p className="mt-2 text-sm leading-relaxed text-muted">{subtitulo}</p>}
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
