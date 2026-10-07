import { loadRoom, watchRoom } from './client.js';
const $ = id => document.getElementById(id);
const VOTES = { '': ['Sem voto', ''], favoravel: ['Favorável', 'yes'], abstido: ['Abstido', 'neutral'], contra: ['Contra', 'no'] };
let stop, generation = 0, lastRevision = -1;
function status(text, type = '') { $('status').textContent = text; $('status').className = `status ${type}`; }
function display(value) { if (Array.isArray(value)) return value.length ? value.join(', ') : 'Nenhum'; if (typeof value === 'boolean') return value ? 'Sim' : 'Não'; return String(value || 'Vazio'); }
function preview(value) { const text = display(value); return text.length > 200 ? `${text.slice(0, 200)}…` : text; }
function eventCard(event) {
  const item = document.createElement('article'); item.className = 'event'; item.dataset.revision = event.revision;
  const time = document.createElement('time'); time.dateTime = event.updatedAt; time.textContent = new Date(event.updatedAt).toLocaleString('pt-BR'); item.append(time);
  for (const change of event.changes || []) {
    const line = document.createElement('div'); line.className = 'change';
    const label = document.createElement('strong'); label.textContent = change.label;
    const detail = document.createElement('span'); detail.textContent = `${preview(change.before)} → ${preview(change.after)}`;
    line.append(label, detail); item.append(line);
  }
  return item;
}
function render(room) {
  if (room.revision < lastRevision) return;
  lastRevision = room.revision;
  for (const field of ['committee', 'hasVeto', 'crisisTitle', 'crisisDetails', 'vetoCountries']) {
    const value = field === 'vetoCountries' ? (room.hasVeto ? display(room.state.vetoCountries) : 'Veto desativado') : field === 'hasVeto' ? display(room.hasVeto) : room[field] || '—';
    $(field).textContent = value;
    if (room.changes?.some(change => change.field === field)) {
      const card = document.querySelector(`[data-field="${field}"]`); card.classList.remove('changed'); void card.offsetWidth; card.classList.add('changed');
    }
  }
  const counts = { favoravel: 0, abstido: 0, contra: 0, '': 0 };
  $('delegations').replaceChildren();
  for (const delegation of room.state.delegations) {
    counts[delegation.vote]++;
    const row = document.createElement('tr');
    if (room.changes?.some(change => change.country === delegation.country)) row.className = 'changed';
    const name = document.createElement('td'); name.textContent = delegation.country;
    const vote = document.createElement('td'), badge = document.createElement('span'); badge.className = `vote ${VOTES[delegation.vote][1]}`; badge.textContent = VOTES[delegation.vote][0]; vote.append(badge);
    const comment = document.createElement('td'); comment.textContent = delegation.comment || 'Sem comentário';
    row.append(name, vote, comment); $('delegations').append(row);
  }
  if (!room.state.delegations.length) { const row = document.createElement('tr'), cell = document.createElement('td'); cell.colSpan = 3; cell.textContent = 'Selecione um comitê no formulário para exibir as delegações.'; row.append(cell); $('delegations').append(row); }
  for (const [id, vote] of Object.entries({ 'count-yes': 'favoravel', 'count-neutral': 'abstido', 'count-no': 'contra', 'count-empty': '' })) $(id).textContent = counts[vote];
  $('updated').textContent = `Última atualização: ${new Date(room.updatedAt).toLocaleTimeString('pt-BR')}`;
  if (room.recentEvents) {
    $('events').replaceChildren(...room.recentEvents.map(eventCard));
  } else if (room.changes?.length && !$('events').querySelector(`[data-revision="${room.revision}"]`)) {
    $('events').querySelector('.empty')?.remove(); $('events').prepend(eventCard(room));
  }
  if (!$('events').children.length) { const empty = document.createElement('p'); empty.className = 'empty'; empty.textContent = 'Nenhuma alteração nesta sala.'; $('events').append(empty); }
  while ($('events').children.length > 50) $('events').lastElementChild.remove();
}
async function connect(id, key) {
  stop?.(); const current = ++generation; lastRevision = -1; status('Conectando…');
  try {
    const room = await loadRoom(id, key); if (current !== generation) return;
    render(room); sessionStorage.setItem('minionu-supervisor', JSON.stringify({ id, key }));
    stop = watchRoom(id, key, update => { if (current === generation) render(update); }, (state, error) => {
      if (current !== generation) return;
      const labels = { connecting: 'Conectando…', connected: 'Ao vivo', reconnecting: 'Sem conexão · reconectando…', error: error || 'Erro de conexão' };
      status(labels[state], state === 'connected' ? 'live' : state === 'error' ? 'error' : '');
    });
  } catch (error) { if (current === generation) status(error.message, 'error'); }
}
$('connect-form').addEventListener('submit', event => { event.preventDefault(); connect($('room').value.trim(), $('key').value.trim()); });
const fragment = new URLSearchParams(location.hash.slice(1));
let cached;
try { cached = JSON.parse(sessionStorage.getItem('minionu-supervisor') || 'null'); } catch { /* Ignore an invalid stored session. */ }
const id = fragment.get('room') || cached?.id, key = fragment.get('key') || cached?.key;
if (id && key) { $('room').value = id; $('key').value = key; history.replaceState(null, '', location.pathname + location.search); connect(id, key); }
