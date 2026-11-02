# Portão do Jev da OPI (DM automática)

Exigência da Compliance da OPI (PARECER-NOV-2026 §3.3, §3.4, §8.2; D-0016 "Jev primeiro"). A regra é
portada de `Lumio/automation/n8n-workflows/build-opi-dm.mjs`. Se a regra mudar, ela muda lá primeiro.

## O que faz

Antes de qualquer DM **e** de qualquer resposta pública (comentário, gatilho por DM/Story e campanhas
"qualquer palavra"):

1. **Casamento estrito** (`casarPalavra`): o texto tem de ser essencialmente a palavra-chave da campanha.
   Caixa, acento, pontuação e emoji não contam. Além da palavra, só entram palavras de cortesia
   (`CORTESIA`), até 8 tokens. Texto extra, duas palavras-chave ou nenhuma palavra isolada vira
   **triagem**, e triagem **nunca** recebe DM automática.
2. **Uma chamada ao Jev** (TypeSafe System One, `jev-latest`) com 5 perguntas `noul`:
   `opi.dm.so_palavra`, `pede_orientacao`, `avalia_operacao`, `reclamacao_legal`, `dado_pessoal`.
   - `reclamacao_legal` ou `dado_pessoal` ≥ 0,05 → `compliance`
   - `pede_orientacao` ou `avalia_operacao` ≥ 0,10 → `luan`
   - `so_palavra` < 0,80 → `manual_revisao`
   - senão → `enviar`
3. **Fail-closed**: sem `TYPESAFE_API_KEY`, com o Jev fora do ar, com resposta incompleta ou com `p` inválido,
   nada sai. Uma falha passageira (rede, 429, 5xx) tem até 3 tentativas no mesmo job (esperas de 2 s e 5 s).
   Depois disso o caso vai para revisão manual (`manual_jev_falhou`).

Se a decisão não for `enviar`, o `DmLog` fica em `HELD_FOR_REVIEW` (com `jevDecision`, `jevReason` e
`jevScores`) e não sai mais sozinho. O reconciliador também o trata como encerrado.

## Registro

- `DmLog.jevDecision` / `jevReason` / `jevScores`: a decisão de cada comentário.
- `JevLedger`: uma linha por pergunta por chamada (`p` nulo + `erro` quando a chamada falhou). O texto do
  comentário não vai para o ledger, só um hash.
- Para exportar no formato do jev-ledger do Lumio (`processo: "openreply.dm"`, `sessao: "OpenReply"`):

  ```
  npx tsx scripts/export-jev-ledger.ts --saida <caminho>/ledger.jsonl [--desde 2026-11-01]
  ```

  O script só lê o banco e não duplica ids já presentes no arquivo.

## Aviso e pausa

- Com `OPI_TELEGRAM_BOT_TOKEN` e `OPI_TELEGRAM_CHAT_ID`, todo caso segurado gera uma mensagem curta com a
  campanha, o @usuário, o texto (até 200 caracteres), a decisão e o motivo. Uma falha no Telegram nunca
  derruba o job.
- Com `OPI_PAUSE_AFTER_FIRST_DM=true`, antes da 1ª DM de uma campanha (quando ela ainda não tem nenhum `DmLog`
  `SENT`) a campanha é desativada de forma atômica (`isActive=false`). Essa 1ª DM sai e o Telegram avisa.
  As seguintes não saem até o Luan reativar a campanha no painel. Um job que já estava em curso e perde a
  corrida é segurado como `campanha_pausada`.

## Variáveis

| Variável | Padrão | Efeito |
|---|---|---|
| `OPI_JEV_GATE` | ligado | `off` desliga o portão. Use só em teste local. |
| `TYPESAFE_API_KEY` | vazio | Sem ela nada é enviado. |
| `OPI_TELEGRAM_BOT_TOKEN`, `OPI_TELEGRAM_CHAT_ID` | vazio | Liga o aviso ao Luan. |
| `OPI_PAUSE_AFTER_FIRST_DM` | desligado | `true` pausa a campanha na 1ª DM. |

## Código

- `lib/opi/jev-gate.ts`: funções puras (casamento, corpo, decisão, ledger, aviso, pausa).
- `lib/opi/jev-worker.ts`: ligação com Prisma, Telegram e o worker.
- `lib/queue/dm-worker.ts`: uma chamada a `aplicarPortaoJev` em `processComment` e outra em `processMessage`.
- Testes: `__tests__/opi-jev-gate.test.ts` e `__tests__/opi-jev-worker.test.ts`.
