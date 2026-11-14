import { I18nProvider } from "@/lib/i18n/provider";
import { getI18n } from "@/lib/i18n/server";

// Layout das telas de entrada (/login e /verify-request): só o idioma. O seletor de idioma fica dentro
// da moldura do tema (components/opi/tela-entrada.tsx), não solto acima dela.
export default async function LayoutEntrada({ children }: { children: React.ReactNode }) {
  const { locale } = await getI18n();
  return <I18nProvider locale={locale}>{children}</I18nProvider>;
}
