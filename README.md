# MINIONU · formulários e supervisão ao vivo

Projeto original de apoio à simulação da ONU, exportado do [CodePen](https://codepen.io/editor/Algu-m-the-typescripter/pen/01a052fc-045a-7897-b632-42de817e5454), com backend e painel para acompanhar alterações.

## O que está incluído

- `codepen-original/`: exportação original completa, com `src`, `dist`, README e licença, sem alterações.
- `index.html`, `script.js`, `style.css`: formulário original, com a ligação ao acompanhamento ao vivo na página. Os campos e a geração de delegações do CodePen foram mantidos.
- `live-integration.js`: lê comitê, veto, países com veto, crise, detalhamento, comentários e votos; salva automaticamente após alterações.
- `supervisor.html`: painel com estado atual, contagem de votos, comentários por delegação, destaque dos campos alterados e histórico das últimas 50 atualizações.
- `backend/`: API Cloudflare Workers, banco D1 e distribuição de atualizações por WebSocket/Durable Objects.
- `.github/workflows/pages.yml`: publicação manual do frontend no GitHub Pages.

## Como usar

1. Publique a API e configure sua URL em `config.js` conforme abaixo.
2. Abra o formulário e clique em **Criar sala de acompanhamento**.
3. Copie o link de supervisão e compartilhe com a pessoa que acompanhará a sala.
4. A pessoa supervisora abre o link e mantém o painel aberto. Os campos, votos e comentários passam a ser atualizados sem recarregar a página.

As alterações são agrupadas por até 150 ms e enviadas em ordem. Em caso de falha de conexão, o formulário mantém o último estado pendente e tenta enviá-lo novamente; o painel reconecta automaticamente e recupera o estado e o histórico recente. O status na tela informa se há atualização pendente ou erro. A transmissão depende de conexão com a internet e da API estar publicada.

Cada sala tem duas chaves: **edição** para o formulário e **supervisão** para acompanhar. A API rejeita alterações feitas com a chave de supervisão. Os links de supervisão usam o fragmento `#`, e a autenticação do WebSocket utiliza um subprotocolo, evitando credenciais na URL enviada ao servidor. O banco armazena somente os hashes das chaves. O formulário guarda a sessão no próprio navegador; o painel guarda a conexão apenas durante a sessão do navegador.

O fluxo previsto é uma pessoa editando o formulário de cada sala e uma ou mais pessoas acompanhando. Abra salas distintas para formulários independentes. Edições simultâneas do mesmo formulário por vários dispositivos utilizam o último estado recebido.

## Publicar a API grátis na Cloudflare

No diretório do projeto, com Node.js instalado:

```sh
npm ci
npx wrangler login
npx wrangler d1 create minionu
```

Copie o ID retornado para `database_id` em `backend/wrangler.toml`. Em `ALLOWED_ORIGINS`, mantenha a origem do site que chamará a API. Para GitHub Pages deste repositório, use `https://galaobiel4.github.io`, sem o caminho `/mun-system`.

```sh
npm run db:remote
npm run deploy:api
```

O comando de publicação retorna a URL da API. Configure `config.js`:

```js
export const API_BASE = 'https://minionu-api.SEUSUBDOMINIO.workers.dev';
```

Nunca coloque senhas, tokens da conta Cloudflare ou chaves de salas no repositório.

## Publicar o site e o painel no GitHub Pages

O repositório `galaobiel4/mun-system` é privado. A disponibilidade de Pages em repositórios privados depende do plano da conta; no GitHub Free, Pages está disponível para repositórios públicos. A privacidade do repositório foi preservada. Confira a [documentação do GitHub](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits).

Quando Pages estiver disponível para o repositório:

1. Em **Settings → Pages**, selecione **GitHub Actions** como origem.
2. Em **Actions → Publish GitHub Pages**, clique em **Run workflow**.
3. Abra o endereço que aparecer na execução. O formulário fica na raiz do site e o painel em `supervisor.html`.
4. Sempre que alterar os arquivos do site ou `config.js`, execute o workflow novamente.

O workflow publica somente os arquivos estáticos do formulário e painel. GitHub Pages não executa o backend; a API permanece na Cloudflare. Veja [como criar um site Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site).

## Planos gratuitos

Workers, D1 e Durable Objects com armazenamento SQLite têm planos gratuitos com limites. A documentação oficial informa 100.000 requisições/dia para Durable Objects; D1 inclui 5 milhões de linhas lidas/dia, 100.000 gravadas/dia e 5 GB. Ao exceder os limites gratuitos, operações podem falhar até a renovação da cota. Confira os limites atuais antes do evento: [Workers](https://developers.cloudflare.com/workers/platform/pricing/), [D1](https://developers.cloudflare.com/d1/platform/pricing/) e [Durable Objects](https://developers.cloudflare.com/durable-objects/platform/pricing/).

## Desenvolvimento local

```sh
npm ci
npm run db:local
npm run dev:api
```

Sirva os arquivos estáticos por HTTP na porta 5500 e configure temporariamente `API_BASE` como `http://localhost:8787`. Não abra os módulos diretamente via `file://`. As origens locais estão incluídas em `backend/wrangler.toml`.

## API

| Rota | Ação | Autorização |
| --- | --- | --- |
| `GET /api/health` | Disponibilidade da API | Sem chave |
| `POST /api/rooms` | Cria sala e retorna chaves uma única vez | Origem permitida |
| `GET /api/rooms/{id}` | Recupera o formulário | Chave de edição ou supervisão |
| `PUT /api/rooms/{id}` | Salva e transmite alterações | Chave de edição |
| `GET /api/rooms/{id}/live` | WebSocket de atualizações e estado inicial | Chave de edição ou supervisão |

HTTP usa `Authorization: Bearer CHAVE`. O WebSocket usa os subprotocolos `mun-live` e `mun-auth.CHAVE`. O objeto enviado por POST/PUT tem o formato:

```json
{
  "committee": "UNICEF",
  "hasVeto": false,
  "crisisTitle": "Título da crise",
  "crisisDetails": "Detalhamento e resolução",
  "state": {
    "vetoCountries": [],
    "delegations": [
      { "country": "Brasil", "comment": "Comentário da delegação", "vote": "favoravel" }
    ]
  }
}
```

Votos aceitos: `favoravel`, `abstido`, `contra` ou vazio. Os dados são validados, salvos com consultas parametrizadas e exibidos como texto no painel.

Os avisos do histórico usam trechos de até 200 caracteres para facilitar a leitura. O estado atual preserva os textos completos. A verificação local cobriu criação de sala, transmissão WebSocket, permissões de supervisão, recuperação do histórico e persistência; no navegador, foram conferidos voto, comentário, detalhamento e recuperação do formulário após recarregar. A implantação remota ainda depende da configuração Cloudflare e Pages descrita acima.

As regras e a lista de países geradas pela função `selecao` seguem o código original; a integração acrescenta persistência e supervisão, sem reinterpretar as regras da simulação.
