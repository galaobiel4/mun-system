import { COUNTRIES, committeeByCode } from './committees.js?v=20261008-lock-v1';
import { calculateVote, MAX_VOTATIONS, VOTE_LABELS } from './voting.js?v=20261008-lock-v1';

const pais = document.getElementById('pais');
const votacao = document.getElementById('votacao');
const vetoIds = { Brasil: 'brasil', 'Rússia': 'russia', EUA: 'eua', 'Índia': 'india', China: 'china', Nigéria: 'nigeria', Alemanha: 'alemanha', França: 'franca', Turquia: 'turquia', 'Reino Unido': 'uk' };
let activeCode = '', history = [];

function readVotes() {
  return COUNTRIES.slice(0, committeeByCode(activeCode).countries).map(country => ({
    country,
    vote: [...votacao.querySelectorAll('input[data-country]:checked')].find(input => input.dataset.country === country)?.value || ''
  }));
}
function readVoting() {
  return { proposal: document.getElementById('proposal')?.value || '', visualDecision: votacao.querySelector('input[name="visual-decision"]:checked')?.value || '', history };
}
function options() {
  return {
    hasVeto: document.getElementById('veto').checked,
    vetoCountries: COUNTRIES.filter(country => document.getElementById(vetoIds[country]).checked),
    visualDecision: readVoting().visualDecision
  };
}
function resultLabel(result) {
  return { approved: 'Aprovada', rejected: 'Recusada', pending: 'Votação incompleta' }[result];
}
function countLabel(count, singular, plural) {
  return count + ' ' + (count === 1 ? singular : plural);
}
function refresh() {
  if (!activeCode) return;
  document.querySelector('.paises-veto').hidden = !document.getElementById('veto').checked;
  const result = calculateVote(activeCode, readVotes(), options());
  const summary = document.getElementById('vote-result');
  summary.dataset.result = result.result;
  let message = resultLabel(result.result);
  if (result.method === 'visual') message += ' por contraste visual. Não é necessário marcar os votos dos países.';
  else {
    const counts = result.tally;
    message += ': ' + countLabel(counts.favoravel, 'favorável', 'favoráveis') + ', ' + countLabel(counts.contra, 'contrário', 'contrários') + ' e ' + countLabel(counts.abstido, 'abstenção', 'abstenções') + '.';
    if (result.vetoes.length) message += ' Veto: ' + result.vetoes.join(', ') + '. A proposta foi recusada imediatamente; os votos restantes não são necessários.';
    else {
      if (counts.unmarked) message += counts.unmarked === 1 ? ' Falta 1 país.' : ' Faltam ' + counts.unmarked + ' países.';
      message += ' Mínimo: ' + countLabel(result.required, 'favorável', 'favoráveis') + '.';
    }
  }
  summary.textContent = message;
  document.getElementById('register-vote').disabled = window.formEditingLocked === true || result.result === 'pending' || !readVoting().proposal.trim() || history.length >= MAX_VOTATIONS;
  const rule = document.getElementById('vote-rule');
  const committee = committeeByCode(activeCode);
  rule.textContent = activeCode === 'CSNU'
    ? 'Maioria de 3/5 do total de delegações. Um voto contrário de país com veto recusa a proposta imediatamente, inclusive com votos pendentes ou contraste visual; abstenção não é veto.'
    : (committee.majority === '2/3' ? 'Maioria de 2/3' : 'Maioria simples') + ' dos votos favoráveis e contrários. Abstenções ficam fora da base de cálculo.';
}
function addText(parent, tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  parent.append(element);
  return element;
}
function renderHistory() {
  const log = document.getElementById('voting-history');
  log.replaceChildren();
  if (!history.length) {
    addText(log, 'p', 'Nenhuma votação registrada neste comitê.');
    return;
  }
  for (const record of [...history].reverse()) {
    const details = document.createElement('details');
    const summary = addText(details, 'summary', resultLabel(record.result) + ' · ' + record.proposal);
    summary.className = 'votation-summary';
    addText(details, 'p', new Date(record.recordedAt).toLocaleString('pt-BR'));
    if (record.method === 'visual') addText(details, 'p', 'Decisão por contraste visual. Votos individuais não foram exigidos.');
    else {
      addText(details, 'p', countLabel(record.tally.favoravel, 'favorável', 'favoráveis') + ' · ' + countLabel(record.tally.contra, 'contrário', 'contrários') + ' · ' + countLabel(record.tally.abstido, 'abstenção', 'abstenções'));
      addText(details, 'p', 'Critério: ' + (record.majority === 'simples' ? 'maioria simples' : record.majority) + '; mínimo de ' + countLabel(record.required, 'favorável', 'favoráveis') + '.');
      if (record.vetoes.length) addText(details, 'p', 'Veto: ' + record.vetoes.join(', ') + '.');
      const list = document.createElement('ul');
      for (const vote of record.votes) addText(list, 'li', vote.country + ': ' + VOTE_LABELS[vote.vote]);
      details.append(list);
    }
    log.append(details);
  }
}
function clearBallot() {
  document.getElementById('proposal').value = '';
  for (const input of votacao.querySelectorAll('input[type="radio"]')) input.checked = false;
}
function publishVotingChange() {
  votacao.dispatchEvent(new CustomEvent('voting-change', { bubbles: true }));
}
function registerVote() {
  if (window.formEditingLocked === true) return;
  const current = readVoting();
  const proposal = current.proposal.trim();
  const votes = readVotes();
  const configuration = options();
  const outcome = calculateVote(activeCode, votes, configuration);
  if (!proposal || outcome.result === 'pending' || history.length >= MAX_VOTATIONS) return;
  const record = { id: crypto.randomUUID(), recordedAt: new Date().toISOString(), proposal, votes, ...configuration, ...outcome };
  history = [...history, record];
  clearBallot();
  renderHistory();
  refresh();
  document.getElementById('voting-feedback').textContent = 'Votação registrada: ' + resultLabel(record.result) + '. Você já pode preencher a próxima proposta.';
  publishVotingChange();
}
function restoreVoting(voting = {}) {
  document.getElementById('proposal').value = voting.proposal || '';
  for (const input of votacao.querySelectorAll('input[name="visual-decision"]')) input.checked = input.value === voting.visualDecision;
  history = Array.isArray(voting.history) ? voting.history : [];
  renderHistory();
  refresh();
}
function mergeHistory(records = []) {
  const combined = new Map(history.map(record => [record.id, record]));
  for (const record of records) combined.set(record.id, record);
  history = [...combined.values()].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  renderHistory();
  refresh();
}
function selecao(code) {
  const committee = committeeByCode(code);
  if (!committee) return;
  activeCode = code;
  history = [];
  pais.replaceChildren();
  votacao.innerHTML = '<div class="section-heading"><span class="section-number">04</span><h2>Votações</h2></div><label for="proposal">Proposta em votação</label>' +
    '<textarea id="proposal" maxlength="2000" rows="3" placeholder="Escreva a proposta que está sendo votada..."></textarea>' +
    '<p id="vote-rule"></p><div id="country-votes"></div>' +
    '<fieldset class="visual-vote"><legend>Contraste visual</legend>' +
    '<label><input type="radio" name="visual-decision" value="approved"> Aprovada</label>' +
    '<label><input type="radio" name="visual-decision" value="rejected"> Recusada</label>' +
    '<button type="button" id="clear-visual">Limpar contraste visual</button></fieldset>' +
    '<p id="vote-result" role="status"></p><button type="button" id="register-vote">Registrar votação</button>' +
    '<p id="voting-feedback" role="status"></p><section class="voting-log" aria-labelledby="voting-log-title">' +
    '<h3 id="voting-log-title">Histórico de votações</h3><div id="voting-history"></div></section>';
  const countryVotes = document.getElementById('country-votes');
  for (const [index, country] of COUNTRIES.slice(0, committee.countries).entries()) {
    const details = document.createElement('details');
    addText(details, 'summary', country);
    const label = addText(details, 'label', 'Comentários:');
    const comment = document.createElement('textarea');
    comment.id = 'comment-' + index;
    comment.className = 'comentarios';
    comment.placeholder = 'Insira comentários sobre a delegação...';
    comment.maxLength = 4000;
    label.htmlFor = comment.id;
    details.append(comment);
    pais.append(details);
    const row = document.createElement('fieldset');
    row.className = 'country-vote';
    addText(row, 'legend', country);
    for (const value of ['favoravel', 'abstido', 'contra']) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = country + 'voto';
      input.value = value;
      input.dataset.country = country;
      label.append(input, ' ' + VOTE_LABELS[value]);
      row.append(label);
    }
    countryVotes.append(row);
  }
  document.getElementById('veto').checked = Boolean(committee.vetoCountries);
  document.getElementById('sem-veto').checked = !committee.vetoCountries;
  for (const country of COUNTRIES) document.getElementById(vetoIds[country]).checked = committee.vetoCountries?.includes(country) || false;
  document.getElementById('register-vote').addEventListener('click', registerVote);
  document.getElementById('clear-visual').addEventListener('click', () => {
    for (const input of votacao.querySelectorAll('input[name="visual-decision"]')) input.checked = false;
    refresh();
    publishVotingChange();
  });
  renderHistory();
  refresh();
}
document.addEventListener('input', event => {
  if (event.target.closest('#votacao')) refresh();
});
document.addEventListener('change', event => {
  if (event.target.closest('#votacao') || event.target.matches('#veto,#sem-veto,.paises-veto input')) refresh();
});
window.selecao = selecao;
window.votingUI = { read: readVoting, restore: restoreVoting, refresh, mergeHistory };



