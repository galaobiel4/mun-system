# MiniONU Piedade

Sistema dos oito comitês, com formulário compartilhado, votações, salvamento no navegador e acompanhamento ao vivo.

## Páginas

- `index.html`: diretores; selecione um comitê ou use `?comite=CDH`, `OMS`, `UNESCO`, `ONUM`, `CSNU`, `ACNUR`, `CDESC` ou `UNICEF`.
- `supervisor.html`: acompanhamento dos oito comitês, delegações, comentários e histórico de votações, com a hora da última atualização no rodapé e sem destaque de campos alterados. O botão **Iniciar crise**, ao final da página, envia um aviso persistente a todos os diretores.
- `dev.html`: administração restrita ao perfil DEV. Criação, ativação/desativação e alteração de senha de usuários; acompanhamento; backup JSON; diagnóstico; encerramento do aviso de crise; reset dos comitês e do acompanhamento; registro administrativo.

Supervisores podem acompanhar e iniciar a crise. Somente DEV pode acessar `/api/users` e `/api/dev/*`. As permissões são verificadas pelo backend. Sessões duram oito horas, ficam em `sessionStorage` e são revogadas ao desativar um usuário ou alterar sua senha.

## Dados e votações

Cada comitê mantém crise, resolução, comentários, votos e votações registradas no D1. A cópia em `localStorage` permite retomar o preenchimento no mesmo navegador. WebSockets distribuem alterações e avisos; consultas periódicas recuperam avisos quando a conexão ao vivo falha.

O histórico de votação fica abaixo dos marcadores, na mesma seção. Informe a proposta e marque as delegações ou **Contraste visual: Aprovada / Recusada**. A decisão visual dispensa votos individuais quando não há veto. Um voto contrário de país com veto recusa a proposta imediatamente, mesmo com votos pendentes ou aprovação por contraste visual. O histórico aceita até 1.000 registros por comitê e é cumulativo no servidor.

Mantidos os critérios do CodePen: maioria simples em CDH, ONUM, UNICEF, CDESC e ACNUR; 2/3 em OMS e UNESCO; 3/5 no CSNU. As abstenções não entram na base da maioria simples ou de 2/3. No CSNU, a base é o total de delegações e o voto contrário de um país configurado com veto impede aprovação. Os demais comitês mantêm nove delegações. UNICEF e CSNU têm dez; o Reino Unido foi incluído no CSNU para permitir o voto dos cinco países com veto. Registros antigos do CSNU preservam suas nove delegações originais.

O reset exige digitar `RESETAR TODOS`. Limpa os oito comitês, as votações, as atualizações do acompanhamento e o aviso de crise; preserva usuários e o registro administrativo. Uma nova geração de dados impede que cópias antigas em navegadores reponham informações apagadas. Faça backup antes de confirmar.

## Backend e publicação

Frontend: GitHub Pages. Backend: Cloudflare Worker `minionu-api`, D1 `minionu` e Durable Objects `ROOMS` / `DASHBOARD`.

```sh
npm ci
npm run db:local
npm run dev:api
```

As variáveis locais ficam em `backend/.dev.vars`, ignorado pelo Git. Para o acesso DEV inicial, configure `DEV_USER` e o segredo `DEV_PASSWORD`. Os acessos anteriores usam `SUPERVISOR_USER` / `SUPERVISOR_PASSWORD` e suas versões `_2`.

```sh
npx wrangler secret put DEV_PASSWORD --config backend/wrangler.toml
npm run db:remote
npm run deploy:api
```

O backend cria de forma idempotente as tabelas administrativas quando necessário, sem apagar dados existentes. As migrações também estão em `backend/migrations/`. O primeiro login DEV configurado cria o usuário e armazena sua senha com PBKDF2 e salt aleatório. Senhas e tokens de produção não devem ser adicionados ao repositório.

Publique o backend antes do frontend. A Cloudflare está conectada à branch `main` com o comando `npx wrangler deploy --config backend/wrangler.toml`. Para o frontend, execute **Actions → Publish GitHub Pages → Run workflow** na branch `main`.

## Verificações

```sh
npm test
npm run test:backend
```

O primeiro comando verifica votação, normalização, histórico cumulativo e armazenamento local. O segundo gera o Worker sem publicar e verifica D1, Durable Objects, permissões DEV, usuários, sessões revogadas, backup, crise persistida, entrega aos oito WebSockets, reset e rejeição de cópias antigas em um ambiente isolado.

`codepen-original/` preserva a exportação original. Textos do usuário são exibidos como texto, sem interpretar HTML. Os formulários de comitê permanecem sem login, conforme o fluxo de uso; quando dois dispositivos editam o mesmo comitê, prevalece o último estado recebido, preservando-se o histórico de votação.


