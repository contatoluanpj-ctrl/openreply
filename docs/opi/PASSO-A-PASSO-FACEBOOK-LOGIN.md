# OpenReply da OPI com o Login do Facebook (07/11/2026)

> O app da Meta "OPI Publicador" (1007623405729386) não oferece mais o login do Instagram ("não está
> disponível para apps mais recentes"). O OpenReply agora roda com `META_LOGIN=facebook`, que usa um token de
> Página que não expira, criado por um usuário do sistema.
>
> Este arquivo substitui os passos 2 (só a parte da Meta) e 5 do `PASSO-A-PASSO-LUAN.md`. Os outros passos continuam
> iguais: freio, Vercel, Easypanel, n8n, campanhas e teste.
>
> **Nunca cole token ou segredo no chat.** Digite direto no `.env`, na Vercel e no Easypanel.

## Já feito (Claude, 07/11)

- No app, a URL da Política de Privacidade (`/privacidade`) foi salva, e `instagram_business_manage_messages` e
  `instagram_business_manage_comments` foram adicionadas.
- No `.env` local:
  - `META_LOGIN=facebook`;
  - `META_PAGE_ID=1427009743825386` (Página "Opçoes para Investidores");
  - `META_IG_USER_ID=17841435577534516` (@opcoesparainvestidores);
  - a linha `META_PAGE_ACCESS_TOKEN=` está vazia, à sua espera.

## 1. Permissões do Login do Facebook no app

No app "OPI Publicador", vá em Casos de uso → API do Instagram → Permissões e recursos e clique em **Adicionar** em:
- `instagram_manage_messages`
- `instagram_manage_comments`
- `pages_manage_metadata`
- `pages_show_list`
- `pages_read_engagement`

(`instagram_basic` já está.)

## 2. Usuário do sistema e token (no Business Manager)

1. Abra business.facebook.com → Configurações do negócio → Usuários → **Usuários do sistema** → Adicionar
   (nome `openreply`, função Admin).
2. Em **Atribuir ativos**, dê controle total à Página "Opçoes para Investidores", à conta do Instagram
   @opcoesparainvestidores e ao app "OPI Publicador".
3. Clique em **Gerar token**:
   - app: OPI Publicador;
   - validade: **Nunca**;
   - marque as permissões do passo 1 e `business_management`.
4. **Copie o token gerado e cole em `META_PAGE_ACCESS_TOKEN=`**, no `C:\opi-work\openreply\.env`, na Vercel (Settings →
   Environment Variables) e no Easypanel (Environment do `openreply-worker`). Não precisa trocar pelo token da Página:
   o OpenReply faz isso sozinho ao conectar (desde 08/11).
5. Em Configurações do app → Básico, clique em **Mostrar** na Chave Secreta do Aplicativo e cole em `FACEBOOK_APP_SECRET=`.

## 3. Webhooks

Faça isto depois do deploy na Vercel, porque é preciso a URL. No app, vá em Webhooks → objeto **Instagram**:
1. Callback `https://<sua-url>/api/webhook`; Verify token = o `WEBHOOK_VERIFY_TOKEN` do `.env`; Verificar e salvar.
2. Assine **`comments`** e **`messages`**.
3. Entre no OpenReply e clique em **Conectar Instagram**. Com `META_LOGIN=facebook` não há tela da Meta: ele usa o
   token do `.env`, conecta @opcoesparainvestidores e inscreve a Página nas mensagens.

## 4. Publicar o app e pedir a análise

- **Publicar:** Painel do app → Publicar (a política de privacidade já está preenchida).
- **App Review:** peça acesso avançado a `instagram_manage_messages` e `instagram_manage_comments`. A Meta costuma
  pedir a verificação da empresa e um vídeo do fluxo (comentário → DM). Até a aprovação, só contas com papel no app
  (admin, testador) disparam a automação; é o teste do passo 8 do outro guia, feito com uma conta testadora.

## Código

- Branch `opi/facebook-login`.
- `lib/meta/login-mode.ts` é a chave do modo.
- `lib/meta/client.ts` usa graph.facebook.com e manda pela Página.
- `lib/meta/facebook-login.ts` faz a conexão sem OAuth.
- `app/api/instagram/connect` desvia para essa conexão no modo `facebook`.
- Testes em `__tests__/meta-facebook-login.test.ts`. Suíte: 469 passando.
