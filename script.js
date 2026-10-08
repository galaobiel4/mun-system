const pais = document.getElementById('pais');
const votacao = document.getElementById('votacao');

// Mantém a lista e o formulário simples do CodePen original.
function selecao(aba) {
  const listapaises = ['Brasil', 'Rússia', 'EUA', 'Índia', 'China', 'Nigéria', 'Alemanha', 'França', 'Turquia', 'Reino Unido'];
  pais.replaceChildren();
  votacao.replaceChildren();
  for (const [i, country] of listapaises.slice(0, aba === 'UNICEF' ? 10 : 9).entries()) {
    const detail = document.createElement('details');
    const summary = document.createElement('summary');
    const name = document.createElement('b');
    name.textContent = country;
    summary.append(name);
    const commentLabel = document.createElement('label');
    commentLabel.className = 'labelComentarios';
    commentLabel.htmlFor = `comentario-${i}`;
    commentLabel.textContent = 'Comentários:';
    const comment = document.createElement('textarea');
    comment.id = commentLabel.htmlFor;
    comment.className = 'comentarios';
    comment.maxLength = 4000;
    comment.placeholder = 'Insira comentários sobre a delegação...';
    detail.append(summary, commentLabel, document.createElement('br'), comment);
    pais.append(detail);
    const countryLabel = document.createElement('span');
    countryLabel.className = 'votopais';
    countryLabel.textContent = country;
    votacao.append(countryLabel);
    for (const [vote, label] of [['favoravel', 'Favorável'], ['abstido', 'Abstido'], ['contra', 'Contra']]) {
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = `${country}voto`;
      input.value = vote;
      input.id = `voto-${i}-${vote}`;
      const text = document.createElement('label');
      text.htmlFor = input.id;
      text.textContent = label;
      votacao.append(input, text);
    }
    votacao.append(document.createElement('br'));
  }
}
