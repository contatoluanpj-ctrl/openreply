# OpenReply da OPI: o que só o Luan faz

> Versão 02/11/2026 (Frente C). Na ordem. Cada passo diz onde fazer e como conferir.
> **Nunca cole chave, token ou segredo no chat.** Digite direto no `.env`, na Vercel, no Easypanel ou no n8n.
> Nenhuma DM real nem resposta pública sai antes do seu "sim" no passo 8.

## 1. Gerar o segredo do freio

No PowerShell, gere um segredo novo (não mostre a ninguém):

```powershell
[Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
```

Guarde esse valor como `OPI_FREIO_SECRET`. Ele vai em três lugares: Vercel, Easypanel e a credencial do n8n (passo 6).

## 2. Chaves no `.env` local (`C:\opi-work\openreply\.env`)

Abra o arquivo no Bloco de Notas e preencha (os nomes já estão no `.env.example`):

| Variável | Onde pegar |
|---|---|
| `TYPESAFE_API_KEY` | Painel do TypeSafe (a mesma do Jev da OPI). Sem ela, nada é enviado. |
| `OPI_TELEGRAM_BOT_TOKEN` | Token do @LuanOPIBot (BotFather). |
| `OPI_TELEGRAM_CHAT_ID` | O seu chat com o bot (o mesmo `owner_chat_id` do `opi_config`). |
| `OPI_FREIO_SECRET` | O valor do passo 1. |
| `OPI_PAUSE_AFTER_FIRST_DM` | Deixe `true` (ou vazio: com o filtro ligado, a pausa da 1ª DM já vem ligada). Só `false` desliga. |
| `OPI_JEV_GATE` | Deixe `on`. |

Conferir: `npx vitest run` continua passando, e eu confirmo o resto sem abrir o arquivo.

## 3. Deploy do app na Vercel

1. Vercel → Add New → Project → importe `contatoluanpj-ctrl/openreply` (branch `opi/jev-gate`, ou a que eu indicar depois do merge).
2. O build usa `vercel-build`, que já roda `prisma migrate deploy`. Não mude.
3. Em Environment Variables, coloque **as mesmas variáveis do `.env` local** (banco Neon `openreply-opi`, Redis Cloud, Gmail SMTP, `NEXTAUTH_*`, as do Meta e as do passo 2).
   `NEXTAUTH_URL` = a URL final da Vercel (ex.: `https://opi-openreply.vercel.app`), sem barra no fim.
4. Deploy. Conferir: abrir `https://<sua-url>/api/health` mostra `database` e `redis` ok (o worker ainda aparece parado até o passo 4).

## 4. Worker no Easypanel (ao lado do n8n, no Contabo)

Suba o worker **depois** do deploy da Vercel do passo 3 (ele aplica as migrações do banco).

1. Easypanel → projeto do n8n → + Service → App → Source: GitHub `contatoluanpj-ctrl/openreply` (mesma branch).
2. Build: **Dockerfile** (já está no repositório).
3. Deploy → Command: `npm run worker`. Sem porta pública.
4. Environment: as mesmas variáveis da Vercel (o worker precisa de `DATABASE_URL`, `REDIS_URL`, `TYPESAFE_API_KEY`, `OPI_*` e as do Meta).
5. Conferir: `https://<sua-url>/api/health` mostra `worker.healthy: true`.

## 5. App Meta: Instagram Login e webhooks

No developers.facebook.com, app da OPI → Instagram → API setup with Instagram login:

1. **OAuth redirect URI** (Business login settings): `https://<sua-url>/api/instagram/callback` (exato, sem barra no fim).
2. **Webhooks**: Callback URL `https://<sua-url>/api/webhook`; Verify token = o `WEBHOOK_VERIFY_TOKEN` do `.env`; Verify and save.
3. Assine os campos **`comments`** e **`messages`**.
4. Permissões: `instagram_business_basic`, `instagram_business_manage_comments`, `instagram_business_manage_messages` e `instagram_business_manage_insights` (as que o OpenReply pede).
5. No painel do OpenReply (`https://<sua-url>`), entre e conecte a conta @opcoesparainvestidores.
6. Conferir: Meta → Webhooks → Test em `comments` → **Send to My Server**; aparece uma linha em `WebhookEvent`.

## 6. n8n: credencial e URL do freio

1. n8n → Credentials → New → **Header Auth**, nome `OpenReply OPI freio`:
   Name = `Authorization`, Value = `Bearer ` + o segredo do passo 1.
2. Data Table `opi_config`: adicione a linha `openreply_url` = `https://<sua-url>` (sem barra no fim).
3. Me avise que criou. Eu gero o bot com o id da credencial e, **com o seu OK**, atualizo o `fWgZNAGBWP3FNWHp`.
4. Conferir no Telegram: `/status_dm` responde "DM automática ligada/pausada" com o número de campanhas.

## 7. Modo Live (exige `/privacidade` no ar)

Os comentários reais só chegam com o app em **Live**. A Meta pede a URL da Política de Privacidade:
`https://opi-opcoes-para-investidores.vercel.app/privacidade` (Frente B). Ela precisa estar publicada antes.
Meta → App settings → Basic → Privacy Policy URL → Live.

## 8. Campanhas JUROS e ERROS (fase A) e o teste

1. No OpenReply → Campanhas → Nova, para cada palavra, copie **exatamente** o texto de `docs/opi/campanhas-fase-a.json`:
   - Palavra-chave: só `JUROS` (Reel 017) ou só `ERROS` (Reel 012), palavra inteira, e o texto do mesmo material.
   - Post: escolha o Reel publicado. Não use "qualquer post", "próximo Reel" nem "qualquer palavra".
   - Mensagem da DM: o `dmMessage` do arquivo, sem mudar uma vírgula. O filtro só aceita os 4 textos aprovados
     (JUROS e ERROS, fases A e B): qualquer diferença, até um espaço, segura **todos** os comentários da campanha
     e manda aviso "campanha fora do aprovado".
   - **Não** ative link rastreado/botão, DM de abertura, "exigir seguir", follow-up nem gatilho por DM/Story: com
     qualquer um deles a campanha também fica segurada.
   - Resposta pública: ligada, com **só** `Te mandei na DM! 📩`. Ela sai **depois** da DM confirmada; se a DM falhar,
     a frase não sai. Qualquer outro texto é descartado.
   - Deixe a campanha **desativada**.
2. Teste com uma conta **sem papel no app** (não admin, não testador). Faça os comentários **nesta ordem**:
   1. Ative só a JUROS. Comente `JUROS qual strike?`: não sai nada e chega o aviso "segurado" (Jev: Luan).
   2. Comente `parabéns`: não sai nada e chega o aviso "comentário sem campanha".
   3. Comente `JUROS`: sai 1 DM e depois a resposta pública; a campanha **se pausa sozinha** e o Telegram avisa.
      A partir daqui, comentários com JUROS chegam como "sem campanha" (campanha pausada) e recebem a DM sozinhos
      quando você reativar (comentários de até 3 dias).
3. Mande o print da 1ª DM para a Compliance conferir (texto idêntico, aviso presente, link certo). Só com o OK dela
   você reativa a campanha no painel.
4. Toda semana, gere a amostra de 10% para a Compliance e exporte o ledger do Jev:

```bash
npx tsx scripts/amostra-compliance.ts --saida amostra-semana.md
```

```bash
npx tsx scripts/export-jev-ledger.ts --saida "<Lumio>/automation/jev-ledger/ledger.jsonl" --desde 2026-11-02
```

## 9. Fase B (quando a captura do site estiver no ar)

Quando `/materiais/juros` e `/materiais/erros` estiverem publicados com o formulário (sessão opi-captura),
troque o texto das duas campanhas pelo de `docs/opi/campanhas-fase-b.json`. A 1ª DM com o texto novo **pausa a
campanha de novo** sozinha (a pausa vale por texto), e a Compliance confere a 1ª DM da fase B antes de você reativar.

## Ficam manuais

TERMOS, COBERTA, ESTRATEGIAS, PROTECAO e LIVROS: **não** crie campanha. Os comentários delas chegam no Telegram como
"comentário sem campanha" e você responde à mão, até o PDF de cada uma ser aprovado.

## Freio

`/pausar_dm` desliga todas as campanhas ativas e vale para tudo: DMs que já estavam a caminho e campanhas que você
reativar ou criar no painel durante a pausa (nada automático sai até o `/retomar_dm`). `/retomar_dm`
religa só as que o freio desligou: nunca uma que pausou na 1ª DM, nem uma que você mexeu no painel durante a pausa
(o bot avisa quantas ficaram de fora). `/status_dm` mostra o estado. Se o bot disser que **não** pausou, desative as
campanhas no painel na hora.

## O que chega no Telegram

- Comentário segurado e 1ª DM: sempre avisam. Comentário sem campanha: até 20 a cada 10 minutos; o que passar disso
  fica em Logs no painel (o aviso seguinte diz quantos foram). Aviso que falhar no Telegram chega depois, sozinho,
  marcado "(Aviso atrasado)".
- `/api/health` fica vermelho se faltar a chave do Jev ou as do Telegram.
- Números com 4+ dígitos, e-mails e links aparecem mascarados. Com sinal de dado pessoal ou caso de Compliance, o
  texto não vem: só o id do comentário, para você abrir no Instagram.

---
Conteúdo educativo. Não é recomendação individual de investimento.
