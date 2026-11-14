# Tema escuro do OPI Central (etapa 2)

Onde mora: `app/globals.css`, bloco `.opi-central`. Os componentes usam só os tokens (classes como
`bg-surface`, `text-muted`, `text-accent-text`); os gráficos usam `lib/opi/cores-grafico.ts`.

## Variantes

O contêiner `.opi-central` aceita `data-tema`:

| Valor | Nome | Fundo | Cartão (vidro sobre o fundo) |
| --- | --- | --- | --- |
| `a` (padrão) | preto neutro com vidro | `#09090B` | `#151517` |
| `b` | grafite azulado | `#11141B` | `#1C202A` |

A escolha fica no cookie `opi_tema` (`lib/opi/tema.ts`). O painel e o `/login` leem o cookie no servidor;
o seletor "Tema" fica no rodapé do menu.

## Tokens novos

`surface-strong` (painel opaco: gaveta, cabeçalho fixo de tabela), `inset`, `track` (trilho de
interruptor e de barra), `faint` (rótulo pequeno), `accent-text` (laranja legível como texto),
`accent-soft` (fundo de selo laranja), `accent-line` (borda laranja), `overlay`, `knob`.

Regra do laranja: `bg-accent` em botão de ação e item ativo; `text-accent-text` em texto e link;
nunca `text-accent` em texto (4,55:1 no cartão A e 4,06:1 no cartão B).

## Contraste medido (WCAG, texto normal pede 4,5:1)

Cálculo com o alfa do vidro composto sobre o fundo. O brilho das auras atrás do vidro não entra na conta.

| Par | A | B |
| --- | --- | --- |
| Texto sobre o fundo | 18,10 | 15,58 |
| Texto sobre o cartão | 16,59 | 13,77 |
| Texto secundário (`muted`) sobre o cartão | 7,12 | 7,57 |
| Texto secundário sobre o cartão em hover | 6,42 | 6,68 |
| Rótulo pequeno (`faint`) sobre o cartão | 5,40 | 5,91 |
| Rótulo pequeno sobre o cartão em hover (pior caso) | 4,87 | 5,22 |
| Laranja de texto (`accent-text`) sobre o cartão | 7,18 | 6,95 |
| Laranja de texto sobre o selo laranja suave | 6,10 | 5,77 |
| Sucesso sobre o cartão | 9,01 | 8,57 |
| Sucesso sobre o selo verde suave | 7,60 | 6,98 |
| Erro sobre o cartão | 6,59 | 6,94 |
| Erro sobre o selo vermelho suave | 5,78 | 5,85 |
| Aviso sobre o cartão | 9,54 | 9,24 |
| Texto escuro do botão sobre o laranja `#D9541E` | 4,90 | 4,90 |
| Texto escuro do botão sobre o laranja em hover | 6,13 | 6,13 |
| Texto invertido sobre a pílula clara | 18,10 | 15,58 |
| Laranja `#D9541E` como borda, ícone ou linha de gráfico sobre o cartão (pede 3:1) | 4,55 | 4,06 |

Branco sobre o laranja `#D9541E` dá 4,01:1 e por isso o botão usa texto escuro.

Também medido na tela (prévia local, 1280 px e 375 px, variantes A e B) em Hoje, Calendário, Seguidores,
Agentes, um departamento com dados, um departamento vazio, login e menu aberto: nenhum texto visível
abaixo de 4,5:1; o mínimo foi 4,90:1 (texto do botão laranja).
