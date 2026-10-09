import { loadDashboard, watchDashboard, startCrisis } from './client.js?v=20261008-lock-v1';
import { initAdminAuth } from './admin-auth.js?v=20261008-lock-v1';
import { COMMITTEES } from './committees.js?v=20261008-lock-v1';
const $ = id => document.getElementById(id);
const votes = { '': ['Sem voto', ''], favoravel: ['Favorável', 'yes'], abstido: ['Abstido', 'neutral'], contra: ['Contra', 'no'] };
let stop, poll, models = new Map(), auth;
const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
function status(message, cls = '') { $('status').textContent = message; $('status').className = `status ${cls}`; }
function count(form) { const result = { favoravel: 0, abstido: 0, contra: 0, '': 0 }; for (const d of form.state.delegations) result[d.vote]++; return result; }
function renderOverview() {
  $('overview').replaceChildren(); let online = 0, delegates = 0;
  for (const committee of COMMITTEES) {
    const form = models.get(committee.code); if (!form) continue;
    const active = form.activeEditors > 0; if (active) online++; delegates += form.state.delegations.length;
    const tile = node('a', undefined, active ? 'online' : ''); tile.href = `#committee-${committee.code}`;
    tile.append(node('strong', committee.code), node('span', active ? `${form.activeEditors} formulário(s) aberto(s)` : 'Formulário fechado'), node('span', `${form.state.delegations.length} delegações · ${count(form).favoravel} favorável(is)`)); $('overview').append(tile);
  }
  $('committee-count').textContent = COMMITTEES.length; $('online-count').textContent = online; $('delegation-count').textContent = delegates;
}
function renderCommittee(form) {
  let card = $(`committee-${form.committee}`);
  if (!card) { card = node('article', undefined, 'committee-card panel'); card.id = `committee-${form.committee}`; $('committee-grid').append(card); }
  card.replaceChildren(); const header = node('div', undefined, 'committee-header');
  header.append(node('h2', form.committee), node('span', form.activeEditors ? `Aberto · ${form.activeEditors}` : 'Fechado', `presence ${form.activeEditors ? 'live' : ''}`));
  card.append(header, node('p', form.name || COMMITTEES.find(c => c.code === form.committee).name, 'committee-name'));
  const crisis = node('div', undefined, 'crisis'); crisis.append(node('small', 'Crise'), node('strong', form.crisisTitle || 'Nenhuma crise informada')); card.append(crisis);
  const details = node('div', undefined, 'crisis'); details.append(node('small', 'Detalhamento e resolução'), node('div', form.crisisDetails || 'Ainda não informado', 'description')); card.append(details);
  card.append(node('div', form.hasVeto ? `Veto: sim · ${(form.state.vetoCountries || []).join(', ') || 'Nenhum país selecionado'}` : 'Veto: não', 'veto'));
  const counts = count(form), totals = node('div', undefined, 'totals'); for (const [vote, [label, cls]] of Object.entries(votes)) totals.append(node('span', `${counts[vote]} ${label}`, cls)); card.append(totals);
  const table = node('table'), head = node('thead'), labels = node('tr'); for (const title of ['Delegação', 'Voto', 'Comentário']) labels.append(node('th', title)); head.append(labels); table.append(head); const body = node('tbody');
  for (const d of form.state.delegations) { const row = node('tr'); const vote = node('td'); vote.append(node('span', votes[d.vote][0], `vote ${votes[d.vote][1]}`)); row.append(node('td', d.country), vote, node('td', d.comment || '—')); body.append(row); }
  table.append(body); const scroll = node('div', undefined, 'table-scroll'); scroll.append(table); card.append(scroll);
  const history = form.state.voting?.history || [], voting = node('details', undefined, 'committee-voting'); voting.append(node('summary', `Votações registradas · ${history.length}`));
  if (form.state.voting?.proposal) voting.append(node('p', `Em votação: ${form.state.voting.proposal}`));
  for (const record of [...history].reverse()) { const item = node('div', undefined, 'vote-record'); item.append(node('strong', record.proposal), node('span', `${record.result === 'approved' ? 'Aprovada' : 'Recusada'} · ${record.method === 'visual' ? 'Contraste visual' : 'Votos das delegações'}`, record.result === 'approved' ? 'yes' : 'no')); voting.append(item); }
  if (!history.length) voting.append(node('p', 'Nenhuma votação registrada.')); card.append(voting);
  const link = node('a', 'Abrir formulário deste comitê', 'form-link'); link.href = `index.html?comite=${encodeURIComponent(form.committee)}`; link.target = '_blank'; link.rel = 'noopener'; card.append(link);
}
function renderLastUpdate() {
  if (!$('last-update')) return;
  const times = [...models.values()].map(form => Date.parse(form.updatedAt)).filter(Number.isFinite);
  $('last-update').textContent = times.length ? `Última atualização: ${new Date(Math.max(...times)).toLocaleTimeString('pt-BR')}` : 'Aguardando atualização';
}
function crisisState(notice) { $('start-crisis').disabled = Boolean(notice); $('start-crisis').textContent = notice ? 'Crise em andamento' : 'Iniciar crise'; $('crisis-status').textContent = notice ? `Aviso enviado: ${notice.title} · ${new Date(notice.startedAt).toLocaleString('pt-BR')}` : ''; }
function consume(update) {
  if (update.type === 'crisis-state') { crisisState(update.notice); return; }
  if (update.type === 'dashboard-snapshot') { models = new Map(update.committees.map(form => [form.committee, form])); $('committee-grid').replaceChildren(); for (const form of update.committees) renderCommittee(form); crisisState(update.system?.crisis); }
  else { const previous = models.get(update.committee); if (!previous) return;
    if (update.type === 'presence') { previous.activeEditors = update.activeEditors; renderCommittee(previous); }
    if (update.type === 'form-update' && update.revision >= previous.revision) { const form = { ...previous, ...update }; models.set(update.committee, form); renderCommittee(form); }
  }
  renderOverview(); renderLastUpdate();
}
auth = await initAdminAuth({
  onLogout() { stop?.(); clearInterval(poll); models.clear(); $('committee-grid')?.replaceChildren(); $('overview')?.replaceChildren(); renderLastUpdate(); },
  async onEnter(session, isCurrent) {
    const snapshot = await loadDashboard(session.token); if (!isCurrent()) return; consume(snapshot); $('dev-link').hidden = session.user.role !== 'dev';
    stop = watchDashboard(session.token, update => { if (isCurrent()) consume(update); }, (state, error) => { if (!isCurrent()) return; if (state === 'expired') { session.logout('Sessão expirada. Entre novamente.'); return; } const labels = { connected: 'Ao vivo · todos os comitês', connecting: 'Conectando…', reconnecting: 'Reconectando…', error: error || 'Sem conexão' }; status(labels[state], state === 'connected' ? 'live' : state === 'error' ? 'error' : ''); });
    poll = setInterval(() => loadDashboard(session.token).then(data => { if (isCurrent()) consume(data); }).catch(() => {}), 30000);
  }
});
$('start-crisis-form').addEventListener('submit', async event => {
  event.preventDefault(); const token = auth.token; if (!token) return; $('start-crisis').disabled = true;
  try { const result = await startCrisis(token, { title: $('notice-title').value, message: $('notice-message').value }); if (auth.token === token) crisisState(result.system.crisis); }
  catch (error) { if (auth.token === token) { $('crisis-status').textContent = error.message; $('start-crisis').disabled = false; } }
});

