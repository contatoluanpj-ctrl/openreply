// A Visão geral virou o Dashboard principal (/dashboard): mesmo resumo, com gráficos e pendências.
import { redirect } from "next/navigation";

export default function VisaoGeralPage() {
  redirect("/dashboard");
}
