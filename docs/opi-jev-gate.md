# Portão do Jev da OPI (DM automática)

Exigência da Compliance da OPI (PARECER-NOV-2026 §3.2, §3.3, §3.4, §8.2; D-0016 "Jev primeiro"). A regra foi
portada de `Lumio/automation/n8n-workflows/build-opi-dm.mjs` (hoje descontinuado). Se a regra mudar, a Compliance
aprova primeiro e o código muda aqui.

## O que faz

Antes de qualquer DM **e** de qualquer resposta pública (comentário, gatilho por DM/Story e campanhas
"qualquer palavra"), nesta ordem:

1. **Campanha conforme** (`motivoCampanhaNaoConforme`): o `dmMessage` tem de ser um dos textos aprovados
   (`TEXTOS_DM_APROVADOS`, cópia literal do DM-TEXTOS v1.1: JUROS e ERROS, fases A e B), a palavra-chave da campanha
   tem de ser exatamente a do material daquele texto (`PALAVRA_DO_TEXTO`: JUROS ↔ juros, ERROS ↔ erros), a campanha
   tem de estar presa a um Reel (`postId`, sem "qualquer post", sem "próximo Reel", sem "qualquer palavra") e não pode
   ter link rastreado (troca a URL), DM de abertura, "exigir seguir" (texto padrão em inglês), follow-up nem gatilho
   por DM/Story. Fora disso: `bloqueado_template`, sem chamar o Jev. Com o portão ligado, toque em botão
   (postback) e follow-up (`processFollowUp`) nunca enviam nada.
2. **Janela de 7 dias** (`foraDaJanela`, §8.2-3): comentário com mais de 7 dias (horário vindo do reconciliador)
   vira `fora_da_janela`. O reconciliador nunca olha mais de 168 h para trás, mesmo que a variável peça mais.
3. **Casamento estrito** (`casarPalavra`): o texto tem de ser essencialmente a palavra-chave da campanha.
   Caixa, acento, pontuação e emoji não contam. Além da palavra, só entram palavras de cortesia
   (`CORTESIA`), até 8 tokens. Texto extra, duas palavras-chave ou nenhuma palavra isolada vira
   **triagem**, e triagem **nunca** recebe DM automática.
4. **Uma chamada ao Jev** (TypeSafe System One, `jev-latest`) com 5 perguntas `noul`:
   `opi.dm.so_palavra`, `pede_orientacao`, `avalia_operacao`, `reclamacao_legal`, `dado_pessoal`.
   - `reclamacao_legal` ou `dado_pessoal` ≥ 0,05 → `compliance`
   - `pede_orientacao` ou `avalia_operacao` ≥ 0,10 → `luan`
   - `so_palavra` < 0,80 → `manual_revisao`
   - senão → `enviar`
5. **Fail-closed**: sem `TYPESAFE_API_KEY`, com o Jev fora do ar, com resposta incompleta ou com `p` inválido,
   nada sai. Uma falha passageira (rede, 429, 5xx) tem até 3 tentativas no mesmo job (esperas de 2 s e 5 s).
   Depois disso o caso vai para revisão manual (`manual_jev_falhou`).

Se a decisão não for `enviar`, o `DmLog` fica em `HELD_FOR_REVIEW` (com `jevDecision`, `jevReason` e
`jevScores`) e não sai mais sozinho. O reconciliador também o trata como encerrado. Um `DmLog` que já está `SENT`
nunca é rebaixado: só ganha a decisão.

## Envio

- **Reserva no momento do envio** (`reservarEnvio`, logo antes de `claimCommentDelivery`, depois de credencial,
  dedup, limites e fila): é aí que valem o freio global e a pausa da 1ª DM, inclusive para jobs que já estavam em
  curso. Campanha desligada ou freio puxado não seguram o comentário: o `DmLog` fica `PENDING` e o reconciliador o
  traz de volta quando a campanha e o freio voltarem (comentários de até 72 h).
- **Freio global** (`freioPuxado`): com o último evento `opi.freio.pausar`, nenhuma DM nem resposta pública
  automática sai, mesmo de campanha reativada ou criada no painel durante a pausa.
- **Pausa da 1ª DM** (§8.2-4): ligada por padrão com o portão ligado (só `OPI_PAUSE_AFTER_FIRST_DM=false` desliga).
  Na 1ª DM de **cada texto** (campanha nova ou troca de fase A → B), o job desativa a campanha de forma atômica e
  envia só aquela DM. O aviso "1ª DM ENVIADA" sai só depois de a DM estar confirmada; se ela falhar, o aviso é
  "a 1ª DM NÃO saiu" (campanha pausada, nada para conferir). As seguintes esperam o Luan reativar depois da
  conferência da Compliance.
- **Registro do texto** (§8.2-6): o `DmLog` de cada envio leva `dmTemplateHash` (`hashTemplate` do texto que saiu).

## Resposta pública (Luan, 02/11/2026)

Com o portão ligado, a resposta pública só pode ser a frase aprovada **"Te mandei na DM! 📩"**
(`FRASE_RESPOSTA_PUBLICA`), e só sai **depois** de a DM estar confirmada (`SENT`): se a DM falhar ou for pulada, a
frase não sai. Se a campanha tiver outro texto, nenhuma resposta pública sai (a DM segue normal).

## Avisos no Telegram

Com `OPI_TELEGRAM_BOT_TOKEN` e `OPI_TELEGRAM_CHAT_ID`:

- caso segurado: campanha, @usuário, texto, decisão e motivo;
- comentário que nenhuma campanha ativa casou (sem palavra-chave, ou campanha pausada): @usuário, post e texto.

Regras:

- números com 4+ dígitos, e-mails e links são mascarados (`mascararTexto`);
- com `compliance` ou `dado_pessoal` ≥ 0,05 o texto **não** vai: só o id do comentário (`omitirTexto`, §3.3);
- no máximo 1 aviso por comentário (várias campanhas, reenvios); todo aviso sai em fila, no máximo 1 por segundo
  (`OPI_TELEGRAM_INTERVALO_MS`, padrão 1000);
- casos segurados e a 1ª DM pausada não têm teto; os de "sem campanha" têm teto de 20 a cada 10 minutos por worker:
  o excedente é contado no aviso seguinte e cada um vira `OperationalEvent` `opi.telegram.suprimido` com o id do
  comentário;
- 429 do Telegram ganha uma nova tentativa; aviso perdido vira `OperationalEvent` `opi.telegram.falhou` com o id do
  comentário, o tipo, a decisão e o texto já mascarado;
- avisos `falhou` dos últimos 3 dias são reenviados no ciclo do reconciliador (`reenviarAvisosPendentes`, até 10
  por ciclo, com "(Aviso atrasado)") até sair; entregue = `resolvedAt`. Os `suprimido` ficam só em Logs;
- caso segurado de um comentário cuja DM já tinha saído avisa "a DM já tinha sido enviada; só a resposta pública foi
  segurada", e o reconciliador não o re-enfileira;
- `/api/health` fica `degraded` (503) com o portão ligado e sem `TYPESAFE_API_KEY`, `OPI_TELEGRAM_BOT_TOKEN` ou
  `OPI_TELEGRAM_CHAT_ID` (mostra só os nomes que faltam, em `checks.opi.faltando`);
- uma falha no Telegram nunca derruba o job.

## Registro e amostra

- `DmLog.jevDecision` / `jevReason` / `jevScores` / `dmTemplateHash`.
- `JevLedger`: uma linha por pergunta por chamada (`p` nulo + `erro` quando a chamada falhou). O texto do
  comentário não vai para o ledger, só um hash. Export no formato do jev-ledger do Lumio:

  ```
  npx tsx scripts/export-jev-ledger.ts --saida <caminho>/ledger.jsonl [--desde 2026-11-01]
  ```

- Amostra semanal de 10% para a Compliance (§8.2-6), só leitura, sem @usuário nem texto do comentário:

  ```
  npx tsx scripts/amostra-compliance.ts [--desde 2026-11-02] [--ate 2026-11-09] [--saida amostra.md]
  ```

## Freio único (/pausar_dm, /retomar_dm, /status_dm)

`POST /api/opi/dm` com `Authorization: Bearer $OPI_FREIO_SECRET` e corpo `{"acao": "pausar" | "retomar" | "status"}`.
Roda numa transação (`prisma.$transaction`): ou desliga as campanhas e grava a lista, ou não muda nada. Comandos
simultâneos são serializados por `pg_advisory_xact_lock`, e os eventos levam `createdAt` tirado depois da trava.
A pausa desliga campanha a campanha (`isActive=true` → `false`) e só guarda as que ela mesma desligou.

- `pausar`: desliga (`isActive=false`) todas as campanhas ativas e guarda a lista e o horário num `OperationalEvent`
  `opi.freio.pausar` (level `WARNING`).
- `retomar`: religa só as campanhas dessa lista que não mudaram no painel durante a pausa (`updatedAt` até o horário
  da pausa); devolve `mexidasNoPainel` com as que ficaram de fora. Uma campanha que já estava desligada (por exemplo,
  pela pausa da 1ª DM) continua desligada.
- `status`: diz se o freio está puxado e quantas campanhas estão ativas.
- Sem `OPI_FREIO_SECRET` (ou com menos de 32 caracteres) a rota responde 503; segredo errado, 401; erro no banco, 500.
  `OPI_FREIO_WORKSPACE_ID` limita o freio a um workspace.

Quem chama é o bot do Telegram no n8n (`build-opi-luanbot.mjs` no Lumio): qualquer resposta que não seja 200 vira
"A DM NÃO foi pausada". O fluxo antigo `build-opi-dm.mjs` está descontinuado, para nunca haver DM em dobro.

## Variáveis

| Variável | Padrão | Efeito |
|---|---|---|
| `OPI_JEV_GATE` | ligado | `off` desliga o portão (e as travas acima). Use só em teste local. |
| `TYPESAFE_API_KEY` | vazio | Sem ela nada é enviado. |
| `OPI_TELEGRAM_BOT_TOKEN`, `OPI_TELEGRAM_CHAT_ID` | vazio | Liga o aviso ao Luan. |
| `OPI_PAUSE_AFTER_FIRST_DM` | ligado com o portão | `false` desliga a pausa da 1ª DM de cada texto. |
| `OPI_FREIO_SECRET` | vazio | Segredo do freio (`/api/opi/dm`). Vazio = rota fechada. |
| `OPI_FREIO_WORKSPACE_ID` | vazio | Limita o freio a um workspace (os eventos sem workspace continuam valendo). |
| `OPI_TELEGRAM_INTERVALO_MS` | 1000 | Intervalo mínimo entre avisos no Telegram. |

## Código

- `lib/opi/jev-gate.ts`: funções puras (textos aprovados, conformidade, janela, casamento, corpo, decisão, ledger,
  aviso, máscara, pausa).
- `lib/opi/jev-worker.ts`: ligação com Prisma, Telegram (limite e deduplicação) e o worker.
- `lib/opi/freio.ts` e `app/api/opi/dm/route.ts`: freio único.
- `lib/queue/dm-worker.ts`: `aplicarPortaoJev` em `processComment` e `processMessage`, releitura de `isActive`,
  resposta pública depois da DM e `dmTemplateHash` no envio.
- `lib/polling/comment-reconciler.ts`: passa o horário do comentário, limita a janela a 168 h e, com o portão
  ligado, não re-enfileira comentário sem resposta pública possível (DM não SENT, ou campanha sem a frase aprovada).
- **Ordem do deploy:** aplicar as migrações (`prisma migrate deploy`, que o `vercel-build` já roda) **antes** de subir
  o worker; sem a coluna `dmTemplateHash` o worker falha fechado (não envia).
- Migrações: `20261102120000_opi_jev_gate` e `20261102200000_opi_dm_template_hash`.
- Testes: `__tests__/opi-jev-gate.test.ts`, `__tests__/opi-jev-worker.test.ts` e `__tests__/opi-freio.test.ts`.
