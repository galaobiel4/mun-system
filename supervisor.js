import { login, loadDashboard, watchDashboard } from './client.js';
import { COMMITTEES } from './committees.js';
const $ = id => document.getElementById(id), SESSION = 'minionu-supervisor-session';
const votes = { '': ['Sem voto', ''], favoravel: ['Favorável', 'yes'], abstido: ['Abstido', 'neutral'], contra: ['Contra', 'no'] };
let stop, expiry, generation = 0, models = new Map();
const node = (tag, text, cls) => { const el = document.createElement(tag); if (text !== undefined) el.textContent = text; if (cls) el.className = cls; return el; };
function status(message, cls = '') { $('status').textContent = message; $('status').className = `status ${cls}`; }
function format(value) { if (Array.isArray(value)) return value.join(', ') || 'Nenhum'; if (typeof value === 'boolean') return value ? 'Sim' : 'Não'; return value || 'Vazio'; }
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
function renderCommittee(form, changes = []) {
  let card = $(`committee-${form.committee}`);
  if (!card) { card = node('article', undefined, 'committee-card'); card.id = `committee-${form.committee}`; $('committee-grid').append(card); }
  card.replaceChildren();
  const header = node('div', undefined, 'committee-header');
  header.append(node('h2', form.committee), node('span', form.activeEditors ? `Aberto · ${form.activeEditors}` : 'Fechado', `presence ${form.activeEditors ? 'live' : ''}`));
  card.append(header, node('p', form.name || COMMITTEES.find(c => c.code === form.committee).name, 'committee-name'));
  const crisis = node('div', undefined, 'crisis'); crisis.append(node('small', 'Crise'), node('strong', form.crisisTitle || 'Nenhuma crise informada')); card.append(crisis);
  const details = node('div', undefined, 'crisis'); details.append(node('small', 'Detalhamento e resolução'), node('div', form.crisisDetails || 'Ainda não informado', 'description')); card.append(details);
  card.append(node('div', form.hasVeto ? `Veto: sim · ${(form.state.vetoCountries || []).join(', ') || 'Nenhum país selecionado'}` : 'Veto: não', 'veto'));
  const counts = count(form), totals = node('div', undefined, 'totals');
  for (const [vote, [label, cls]] of Object.entries(votes)) totals.append(node('span', `${counts[vote]} ${label}`, cls)); card.append(totals);
  const table = node('table'), head = node('thead'), labels = node('tr'); for (const title of ['Delegação', 'Voto', 'Comentário']) labels.append(node('th', title)); head.append(labels); table.append(head); const body = node('tbody');
  for (const d of form.state.delegations) {
    const row = node('tr', undefined, changes.some(change => change.country === d.country) ? 'changed' : '');
    const vote = node('td'); vote.append(node('span', votes[d.vote][0], `vote ${votes[d.vote][1]}`)); row.append(node('td', d.country), vote, node('td', d.comment || '—')); body.append(row);
  }
  table.append(body); const scroll = node('div', undefined, 'table-scroll'); scroll.append(table); card.append(scroll);
  card.append(node('p', form.updatedAt ? `Última atualização: ${new Date(form.updatedAt).toLocaleTimeString('pt-BR')}` : 'Aguardando abertura do formulário', 'meta'));
  const link = node('a', 'Abrir formulário deste comitê', 'form-link'); link.href = `index.html?comite=${encodeURIComponent(form.committee)}`; link.target = '_blank'; link.rel = 'noopener'; card.append(link);
  if (changes.length) { card.classList.remove('changed'); void card.offsetWidth; card.classList.add('changed'); }
}
function eventCard(event) {
  const card = node('article', undefined, 'event'); card.dataset.event = `${event.committee}-${event.revision}`;
  card.append(node('time', new Date(event.updatedAt).toLocaleString('pt-BR')), node('h3', event.committee));
  for (const change of event.changes) card.append(node('p', `${change.label}: ${format(change.before)} → ${format(change.after)}`)); return card;
}
function consume(update) {
  if (update.type === 'dashboard-snapshot') {
    models = new Map(update.committees.map(form => [form.committee, form])); $('committee-grid').replaceChildren(); for (const form of update.committees) renderCommittee(form);
    $('events').replaceChildren(...update.recentEvents.map(eventCard));
  } else {
    const previous = models.get(update.committee); if (!previous) return;
    if (update.type === 'presence') { previous.activeEditors = update.activeEditors; renderCommittee(previous); }
    if (update.type === 'form-update' && update.revision >= previous.revision) {
      const form = { ...previous, ...update }; models.set(update.committee, form); renderCommittee(form, update.changes);
      if (!$('events').querySelector(`[data-event="${update.committee}-${update.revision}"]`)) { $('events').querySelector('.empty')?.remove(); $('events').prepend(eventCard(update)); }
    }
  }
  renderOverview(); while ($('events').children.length > 50) $('events').lastElementChild.remove();
  if (!$('events').children.length) $('events').append(node('p', 'Nenhuma alteração recebida ainda.', 'empty'));
}
function logout(message = '') { generation++; stop?.(); clearTimeout(expiry); sessionStorage.removeItem(SESSION); models.clear(); $('committee-grid').replaceChildren(); $('overview').replaceChildren(); $('events').replaceChildren(); $('panel').hidden = true; $('login-area').hidden = false; $('password').value = ''; $('login-error').textContent = message; }
async function enter(session) {
  const current = ++generation; stop?.(); clearTimeout(expiry);
  if (session.expiresAt <= Date.now()) { logout('Sessão expirada. Entre novamente.'); return; }
  try {
    const snapshot = await loadDashboard(session.token); if (current !== generation) return;
    consume(snapshot); $('login-area').hidden = true; $('panel').hidden = false; sessionStorage.setItem(SESSION, JSON.stringify(session)); $('password').value = '';
    expiry = setTimeout(() => logout('Sessão expirada. Entre novamente.'), session.expiresAt - Date.now());
    stop = watchDashboard(session.token, update => { if (current === generation) consume(update); }, (state, error) => {
      if (current !== generation) return; if (state === 'expired') { logout('Sessão expirada. Entre novamente.'); return; }
      const labels = { connected: 'Ao vivo · todos os comitês', connecting: 'Conectando…', reconnecting: 'Reconectando…', error: error || 'Sem conexão' }; status(labels[state], state === 'connected' ? 'live' : state === 'error' ? 'error' : '');
    });
  } catch (error) { logout(error.message); }
}
$('login-form').addEventListener('submit', async event => {
  event.preventDefault(); $('login-button').disabled = true; $('login-error').textContent = '';
  try { await enter(await login($('username').value.trim(), $('password').value)); } catch (error) { $('login-error').textContent = error.message; }
  finally { $('login-button').disabled = false; }
});
$('logout').addEventListener('click', () => logout());
try { const session = JSON.parse(sessionStorage.getItem(SESSION) || 'null'); if (session) await enter(session); } catch { logout(); }
