import { getI18n } from "@/lib/i18n/server";
import Link from "next/link";
import { TelaEntrada } from "@/components/opi/tela-entrada";

export async function generateMetadata() {
  const { t } = await getI18n();
  return {
    title: t("Check your email - OPI Central"),
    description: t("A sign-in link was sent to your email."),
  };
}

export default async function VerifyRequestPage() {
  const { t } = await getI18n();
  return (
    <TelaEntrada>
      <div className="opi-glass p-6 text-center sm:p-8">
        <h2 className="mb-2 text-lg font-semibold text-foreground">{t("Check your email")}</h2>
        <p className="text-sm text-muted">
          {t("We sent you a secure sign-in link. Open it on this device to continue.")}
        </p>
        <p className="mt-6 text-sm">
          <Link href="/login" className="font-semibold text-accent-text hover:underline">
            {t("Back to sign in")}
          </Link>
        </p>
      </div>
    </TelaEntrada>
  );
}
