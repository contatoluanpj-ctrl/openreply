// Testa o roteador contra o Jev de verdade (só leitura; não grava nada).
import { sugerirRota } from "../lib/opi/roteador";
const casos = [
  "quero começar a criar a área da comunidade",
  "muda a música do vídeo 03 e tira o corte seco no começo",
  "agenda o reel 07 para quinta às 18h",
  "essa legenda do 05 pode ir ao ar? fala de ganho",
  "quanto estamos gastando por mês com ferramentas?",
  "a caixa de entrada do painel não abre",
  "escreve 7 roteiros novos sobre put",
];
(async () => {
  for (const c of casos) {
    const r = await sugerirRota(c, process.env.TYPESAFE_API_KEY!);
    console.log(c, "=>", r ? `${r.destinos.join("+")} | ${r.motivo} | top: ${r.ranking.map(x=>x.id+":"+x.p.toFixed(2)).join(", ")} | varias ${r.variasAreas?.toFixed(2)}` : "FALHOU");
  }
})();
