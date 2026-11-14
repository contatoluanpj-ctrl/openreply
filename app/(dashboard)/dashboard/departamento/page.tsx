// Sem slug não há departamento: volta para o início.
import { redirect } from "next/navigation";

export default function DepartamentoSemSlug() {
  redirect("/dashboard");
}
