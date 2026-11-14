const fmt = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "14/11 às 18:00" no horário de Brasília, a partir do ISO de RedeView.ultimoPostEm. */
export function rotuloUltimoPost(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "data não informada";
  const p = Object.fromEntries(fmt.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.day}/${p.month} às ${p.hour}:${p.minute}`;
}
