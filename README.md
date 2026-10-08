# MINIONU · acompanhamento geral dos 8 comitês

O formulário original do [CodePen](https://codepen.io/editor/Algu-m-the-typescripter/pen/01a052fc-045a-7897-b632-42de817e5454) agora envia suas alterações automaticamente ao painel geral. A cópia original exportada está em `codepen-original/`, com arquivos `src`, `dist`, configuração e licença preservados.

## Fluxo de uso

1. Cada comitê abre seu formulário pelo link correspondente ou seleciona o comitê no select original.
2. O formulário conecta automaticamente ao backend. Crise, proposta, votos e comentários das delegações são salvos e transmitidos enquanto a pessoa preenche. As regras de maioria e veto vêm dos objetos do JavaScript original.
3. A supervisão abre `supervisor.html` e entra com login e senha.
4. O painel carrega os **8 comitês juntos**, com todas as delegações, votos, comentários, crise e detalhamento. Não há criação de salas, cadastro de chaves ou seleção de comitê no painel.

O resumo identifica quantos formulários estão abertos, e cada comitê mostra o estado da conexão. A atualização usa WebSocket, com agrupamento de digitação por até 150 ms. O formulário tenta reenviar o último estado se a conexão falhar, e o painel reconecta e recupera o estado e as últimas 50 atualizações.

## Propostas e votação

Escreva a proposta na caixa **PROPOSTA** e registre um voto para cada delegação. O formulário mostra a contagem, a regra e o resultado previsto. Clique em **Concluir votação** para registrar o resultado definitivo no servidor: **APROVADA**, **NEGADA** ou **VETADA**.

| Comitê | Critério do JavaScript original |
| --- | --- |
| CDH, ONUM, UNICEF, CDESC, ACNUR | Maioria simples: mais da metade dos votos válidos |
| OMS, UNESCO | Pelo menos dois terços dos votos válidos |
| CSNU | Pelo menos três quintos dos votos válidos, sem voto contrário de país com veto |

Votos válidos são **Favorável** e **Contra**. Abstenções ficam registradas, mas não entram no denominador. Limiares fracionários são arredondados para cima. Todas as delegações precisam votar antes da conclusão; somente abstenções resultam em proposta negada. As regras e os países com veto são aplicados pelo backend e exibidos no formulário.

O CSNU original possui nove delegações e não inclui o Reino Unido na lista exibida. O objeto original cita o Reino Unido entre os países com veto; somente países presentes no formulário podem votar. A lista original foi preservada. Rússia, EUA, China e França exercem veto com voto **Contra**; uma abstenção não veta.

Cada registro mantém o texto completo da proposta, data, resultado, regra, contagem, países que vetaram, votos e comentários das delegações e contexto da crise. O histórico aparece no formulário do comitê e no painel da supervisão. Ao concluir, o formulário limpa apenas a proposta e os votos; crise e comentários permanecem para a próxima proposta.

O servidor grava o registro e inicia a próxima rodada na mesma transação. Tentativas repetidas usam o mesmo identificador para não duplicar o registro. Um formulário desatualizado não pode sobrescrever uma votação já concluída; o navegador preserva seu rascunho local para consulta e carrega a rodada atual.

## Código para colar no CodePen

[`codepen-updated/`](codepen-updated/README.md) contém o HTML, CSS e JavaScript atualizados para os três painéis do [Pen original](https://codepen.io/editor/Algu-m-the-typescripter/pen/01a052fc-045a-7897-b632-42de817e5454). O JavaScript incorpora os módulos locais. Defina `API_BASE` com o endereço da API publicada antes de usar a persistência. Execute `npm run build:codepen` para regenerar os arquivos depois de alterar o frontend.

A cópia exportada em `codepen-original/` foi preservada. O pacote atualizado deve ser colado e salvo na conta do CodePen; alterações no GitHub não atualizam automaticamente o editor remoto.

## Links dos formulários

Os links abaixo são relativos ao endereço publicado do site:

| Comitê | Formulário |
| --- | --- |
| CDH | `index.html?comite=CDH` |
| OMS | `index.html?comite=OMS` |
| UNESCO | `index.html?comite=UNESCO` |
| ONU Mulheres | `index.html?comite=ONUM` |
| CSNU | `index.html?comite=CSNU` |
| ACNUR | `index.html?comite=ACNUR` |
| CDESC | `index.html?comite=CDESC` |
| UNICEF | `index.html?comite=UNICEF` |

`supervisor.html` é o único endereço de acompanhamento. Cada comitê tem um formulário compartilhado e persistente no servidor; os links podem ser abertos em máquinas diferentes. O código original gera 9 delegações nos demais comitês e 10 no UNICEF; essa lista foi mantida. Os 8 comitês são os existentes no select original, confirmados pelo autor.

## Publicação inicial — feita pela administração

O site precisa de uma publicação inicial da API e de uma definição de login e senha no servidor. Essa etapa é feita uma vez por quem administra a hospedagem; a pessoa supervisora apenas entra no painel. Senhas não ficam no código público nem são configuradas no navegador da supervisão.

Com Node.js instalado, no diretório do projeto:

```sh
npm ci
npx wrangler login
npx wrangler d1 create minionu
```

Copie o ID retornado para `database_id` em `backend/wrangler.toml`. A origem do frontend está em `ALLOWED_ORIGINS`; para o GitHub Pages deste projeto, é `https://galaobiel4.github.io`, sem `/mun-system`.

Defina o login e uma senha forte por meio dos segredos da Cloudflare. Os comandos pedem os valores interativamente:

```sh
npx wrangler secret put SUPERVISOR_USER --config backend/wrangler.toml
npx wrangler secret put SUPERVISOR_PASSWORD --config backend/wrangler.toml
npm run db:remote
npm run deploy:api
```

Para atualizar uma instalação existente com o registro de propostas, aplique também a nova migração com `npm run db:remote` antes de publicar a API atualizada com `npm run deploy:api`. A migração `0003_proposals.sql` cria a tabela de registros sem apagar os formulários anteriores. O `database_id` e `API_BASE` deste repositório ainda são valores de configuração inicial.

Use uma senha longa e exclusiva. O painel emite uma sessão assinada com validade de 8 horas e limita tentativas de login. Os endpoints gerais e o WebSocket do painel exigem autenticação. Os formulários por comitê não exigem login, conforme o fluxo solicitado.

O comando de publicação retorna a URL da API. Configure somente esse endereço em `config.js`:

```js
export const API_BASE = 'https://minionu-api.SEUSUBDOMINIO.workers.dev';
```

Não adicione senhas, tokens ou arquivos `.dev.vars` ao GitHub. Nenhuma credencial de produção é fornecida no repositório.

## Site e painel no GitHub Pages

O repositório `galaobiel4/mun-system` é privado; sua privacidade foi preservada. Pages em repositórios privados depende do plano da conta. No GitHub Free, Pages está disponível em repositórios públicos. Confira a [documentação de disponibilidade](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

Quando Pages estiver disponível para o repositório:

1. Em **Settings → Pages**, selecione **GitHub Actions**.
2. Em **Actions → Publish GitHub Pages**, execute **Run workflow**.
3. Abra a URL apresentada pela execução. Distribua os 8 links de formulário listados acima e o endereço `supervisor.html`.
4. Após mudar os arquivos do site ou `config.js`, execute o workflow novamente.

GitHub Pages publica os arquivos estáticos; a API, o banco e a comunicação ao vivo rodam na Cloudflare. Veja [como criar o site Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

## Hospedagem gratuita

Workers, D1 e Durable Objects com SQLite oferecem planos gratuitos com limites. D1 inclui 5 milhões de linhas lidas/dia, 100.000 gravadas/dia e 5 GB; Durable Objects inclui 100.000 requisições/dia. Quando uma cota gratuita é excedida, operações podem falhar até sua renovação. Confira os limites antes de um evento: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/) e [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Desenvolvimento local

```sh
npm ci
npm run db:local
npm run dev:api
```

Para testar o login localmente, crie `backend/.dev.vars` com `SUPERVISOR_USER` e `SUPERVISOR_PASSWORD` exclusivos do desenvolvimento. Esse arquivo é ignorado pelo Git. Sirva o frontend por HTTP na porta 5500 e configure temporariamente `API_BASE` como `http://localhost:8787`.

## Estrutura e API

- `committees.js`: lista compartilhada dos 8 comitês, suas delegações e regras originais.
- `voting.js`: cálculo compartilhado de maioria, abstenções e veto.
- `live-integration.js`: ligação do formulário original ao acompanhamento automático.
- `supervisor.html`, `supervisor.js`, `supervisor.css`: login e painel geral.
- `backend/src/index.js`: autenticação, persistência, presença e distribuição das atualizações.
- `backend/migrations/`: histórico das migrações; a versão geral utiliza `committee_forms` e `committee_events`.
- `codepen-original/`: exportação original sem alterações.
- `codepen-updated/`: arquivos atualizados para colar nos painéis do CodePen.

| Rota | Uso |
| --- | --- |
| `POST /api/auth/login` | Login e senha; retorna sessão de supervisão |
| `GET /api/dashboard` | Estado dos 8 comitês, presença e histórico; exige sessão |
| `GET /api/dashboard/live` | Atualizações gerais por WebSocket; exige sessão |
| `GET /api/committees/{codigo}` | Abre automaticamente o formulário do comitê |
| `PUT /api/committees/{codigo}` | Salva e distribui alterações |
| `POST /api/committees/{codigo}/proposals` | Conclui a votação, registra resultado e inicia a próxima rodada |
| `GET /api/committees/{codigo}/live` | Conexão do formulário e indicação de presença |

O painel usa `Authorization: Bearer SESSAO` em HTTP e os subprotocolos `mun-live` e `mun-auth.SESSAO` no WebSocket. A sessão fica em `sessionStorage`, é eliminada ao sair e precisa ser renovada ao expirar. O backend valida comitê, delegações e votos; textos são exibidos sem interpretar HTML.

O estado atual mantém textos completos; o histórico usa trechos de até 200 caracteres. O fluxo de edição previsto é um formulário por comitê; se vários dispositivos editarem o mesmo comitê simultaneamente, prevalece o último estado recebido. O painel indica conexões abertas, não a atividade de foco de cada janela.

O limite de 200 caracteres vale para o histórico geral de alterações; o registro de cada proposta mantém os textos completos. Envie `proposalText`, `votingRound` e as delegações no formulário. A rota de conclusão também exige `requestId` em formato UUID e calcula o resultado no servidor. Snapshots e atualizações incluem `proposals`, em ordem da rodada mais recente. `PUT` não altera os registros concluídos. Uma rodada desatualizada recebe HTTP 409 com `snapshot` atual para recuperação.

## Verificação realizada

`npm test` verifica os limiares de votação, empates, abstenções, votos pendentes e vetos. `npm run test:integration` utiliza Wrangler e D1 locais isolados para verificar os três resultados, persistência após reiniciar, submissões simultâneas, repetição sem duplicação, rodadas desatualizadas e proteção do histórico contra alterações enviadas pelo cliente.

Nesta atualização passaram os 9 testes de cálculo e os 11 testes da API local. A verificação em Chromium também confirmou os três resultados, limpeza da próxima proposta, preservação de comentários, leitura após recarregar, textos exibidos sem interpretar HTML, recuperação de resposta perdida sem duplicação, atualização ao vivo da supervisão e uso do pacote para o CodePen.

O backend local foi verificado com login válido e inválido, sessões adulteradas e expiradas, 8 formulários conectados ao mesmo tempo, isolamento dos dados entre comitês, presença, desconexão e recuperação do histórico. No navegador, o painel exibiu os 8 comitês abertos e 73 delegações; mudanças de crise, voto e comentário em comitês diferentes chegaram à mesma tela. A implantação remota e as credenciais de produção dependem da publicação inicial descrita acima.
