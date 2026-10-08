# Atualização do CodePen

Estes arquivos usam o HTML e CSS originais e acrescentam proposta, contagem e registro das votações. O original exportado continua em `codepen-original/`.

No [CodePen original](https://codepen.io/editor/Algu-m-the-typescripter/pen/01a052fc-045a-7897-b632-42de817e5454):

1. Cole `index.html` no painel HTML.
2. Cole `style.css` no painel CSS.
3. Cole `script.js` no painel JavaScript, sem pré-processador.
4. Defina `API_BASE` no início do JavaScript como a URL publicada da API Cloudflare. Os dados são salvos no mesmo backend do formulário e da supervisão.
5. Se a supervisão estiver publicada em outro endereço, ajuste o link do painel no HTML.

Antes de usar, aplique a migração `0003_proposals.sql` e publique a API atualizada conforme o README principal. O backend permite as origens `https://codepen.io` e `https://cdpn.io`; se o preview usar outra origem, acrescente a origem exata em `ALLOWED_ORIGINS` e publique a API novamente.

Os arquivos são gerados a partir do frontend do repositório com `npm run build:codepen`. A geração incorpora os módulos no JavaScript, sem depender de imports locais. A cópia no editor do CodePen precisa ser salva pela pessoa com acesso à conta; este pacote não altera o Pen remoto automaticamente.
