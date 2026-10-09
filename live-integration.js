import { loadForm, watchForm, createAutosave, loadEditingStatus } from './client.js?v=20261008-lock-v1';
import { committeeByCode, emptyForm } from './committees.js?v=20261008-lock-v1';
import { createFormStore } from './storage.js?v=20261008-lock-v1';

const $ = id => document.getElementById(id);
const VETO = { brasil: 'Brasil', india: 'Índia', eua: 'EUA', turquia: 'Turquia', russia: 'Rússia', china: 'China', nigeria: 'Nigéria', alemanha: 'Alemanha', franca: 'França', uk: 'Reino Unido' };
let browserStorage;
try { browserStorage = window.localStorage; } catch {}
const store = createFormStore(browserStorage);
let activeCode, autosave, stopWatch, poll, generation = 0, lastRevision = -1, resetEpoch = '', edits = 0, localSaved = false;
let editingLocked = true, unlockTimer, editingKnown = false;
window.formEditingLocked = true;
function disableFields() {
  for (const field of document.querySelectorAll('#configuracao input,#crise input,#crise textarea,#pais textarea,#votacao input,#votacao textarea,#votacao button')) field.disabled = editingLocked;
  window.formEditingLocked = editingLocked; window.votingUI?.refresh();
}
function applyEditing(editing, reopen = true) {
  if (!editing || typeof editing.locked !== 'boolean') return false;
  const wasLocked = editingLocked;
  editingKnown = true; editingLocked = editing.locked; disableFields(); clearTimeout(unlockTimer);
  $('editing-notice').hidden = !editingLocked;
  $('editing-message').textContent = editing.until
    ? `O preenchimento está bloqueado até ${new Date(editing.until).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })} (horário de Brasília). Você pode consultar os comitês normalmente.`
    : 'O preenchimento está bloqueado pela organização. Você pode consultar os comitês normalmente.';
  if (editingLocked) { autosave?.stop(); $('comite').disabled = false; }
  if (editingLocked && editing.until) {
    const remaining = Date.parse(editing.until) - editing.serverTime;
    unlockTimer = setTimeout(refreshEditing, Math.max(250, Math.min(remaining + 100, 2147483647)));
  }
  if (reopen && wasLocked && !editingLocked && activeCode) { open(activeCode); return true; }
  return false;
}
async function refreshEditing() { try { const data = await loadEditingStatus(); applyEditing(data.editing); } catch { if (!editingKnown) $('editing-message').textContent = 'Consultando a disponibilidade de preenchimento. Você pode visualizar o site enquanto isso.'; } }

function showNotice(notice) {
  const banner = $('crisis-notice'); banner.hidden = !notice;
  if (!notice) return;
  banner.dataset.notice = notice.id;
  $('crisis-notice-title').textContent = notice.title;
  $('crisis-notice-message').textContent = notice.message;
  $('crisis-notice-time').textContent = `Iniciada em ${new Date(notice.startedAt).toLocaleString('pt-BR')}`;
  let acknowledged = false;
  try { acknowledged = browserStorage?.getItem('minionu-crisis-read') === notice.id; } catch {}
  $('crisis-notice-read').textContent = acknowledged ? 'Aviso lido ✓' : 'Entendi';
  $('crisis-notice-read').disabled = acknowledged;
}
$('crisis-notice-read').addEventListener('click', () => {
  try { browserStorage?.setItem('minionu-crisis-read', $('crisis-notice').dataset.notice); } catch {}
  $('crisis-notice-read').textContent = 'Aviso lido ✓'; $('crisis-notice-read').disabled = true;
});

function localStatus(ok) {
  const status = $('storage-status');
  status.textContent = ok ? 'Salvo neste navegador' : 'Não foi possível salvar no navegador';
  status.dataset.state = ok ? 'saved' : 'error';
}
function read() {
  return {
    committee: activeCode, resetEpoch, hasVeto: $('veto').checked,
    crisisTitle: document.querySelector('.crise').value,
    crisisDetails: document.querySelector('.detalhamentocrise').value,
    state: {
      vetoCountries: Object.entries(VETO).filter(([id]) => $(id).checked).map(([, name]) => name),
      voting: window.votingUI.read(),
      delegations: [...document.querySelectorAll('#pais details')].map(detail => {
        const country = detail.querySelector('summary').textContent.trim();
        return { country, comment: detail.querySelector('.comentarios').value,
          vote: [...document.querySelectorAll('#votacao input[data-country]:checked')].find(input => input.dataset.country === country)?.value || '' };
      })
    }
  };
}
function persist(dirty) {
  localSaved = store.save(activeCode, read(), { dirty, revision: lastRevision });
  localStatus(localSaved);
}
function restore(form) {
  resetEpoch = form.resetEpoch || '';
  $('comite').value = form.committee;
  window.selecao(form.committee);
  $('veto').checked = form.hasVeto;
  $('sem-veto').checked = !form.hasVeto;
  document.querySelector('.crise').value = form.crisisTitle;
  document.querySelector('.detalhamentocrise').value = form.crisisDetails;
  for (const [id, country] of Object.entries(VETO)) $(id).checked = form.state.vetoCountries.includes(country);
  for (const detail of document.querySelectorAll('#pais details')) {
    const country = detail.querySelector('summary').textContent.trim();
    const delegation = form.state.delegations.find(d => d.country === country);
    detail.querySelector('textarea').value = delegation?.comment || '';
    for (const input of document.querySelectorAll('#votacao input[data-country]')) {
      if (input.dataset.country === country) input.checked = input.value === delegation?.vote;
    }
  }
  window.votingUI.restore(form.state.voting);
  disableFields();
}
async function initialForm(code) {
  let timer;
  try {
    return await Promise.race([
      loadForm(code),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Sem resposta do servidor.')), 5000); })
    ]);
  } finally { clearTimeout(timer); }
}
async function open(code) {
  if (!committeeByCode(code)) return;
  const current = ++generation;
  autosave?.stop(); stopWatch?.(); clearInterval(poll); autosave = undefined; stopWatch = undefined;
  activeCode = code; edits = 0;
  const cached = store.read(code);
  lastRevision = cached?.revision ?? -1;
  store.rememberCommittee(code);
  restore(cached?.form || emptyForm(code));
  $('comite').disabled = false;
  const url = new URL(location.href);
  url.searchParams.set('comite', code);
  history.replaceState(null, '', url);

  let dirty = cached?.dirty || false;
  // A edição fica disponível imediatamente. Uma resposta atrasada não substitui alterações locais.
  try {
    const form = await initialForm(code);
    if (current !== generation) return;
    showNotice(form.notice);
    applyEditing(form.editing, false);
    if ((form.resetEpoch || '') !== resetEpoch) {
      restore(form); dirty = false; edits = 0; lastRevision = form.revision;
    } else if (!edits && !dirty && lastRevision <= form.revision) {
      restore(form);
    } else {
      window.votingUI.mergeHistory(form.state.voting?.history);
      dirty = true;
    }
    lastRevision = Math.max(lastRevision, form.revision);
  } catch {
    if (current !== generation) return;
    // Com falha na rede, a cópia local continua disponível e será reenviada.
    dirty = Boolean(cached) || edits > 0;
  }
  if (current !== generation) return;
  persist(dirty || edits > 0);
  autosave = createAutosave(code, (state, _error, saved) => {
    if (current !== generation) return;
    if (state === 'reset') { open(code); return; }
    if (state === 'blocked') { applyEditing(saved); return; }
    if (state === 'saved') {
      lastRevision = Math.max(lastRevision, saved.revision);
      window.votingUI.mergeHistory(saved.state.voting?.history);
      persist(false);
    }
    // Evita trocar de comitê durante um envio; a falha deixa a troca disponível.
    $('comite').disabled = !editingLocked && (state === 'pending' || state === 'saving');
  });
  const receive = update => {
    if (current !== generation) return;
    if (applyEditing(update.editing)) return;
    if (Object.hasOwn(update, 'notice')) showNotice(update.notice);
    if (update.type === 'crisis-state' || update.type === 'editing-state') return;
    if ((update.resetEpoch || '') !== resetEpoch) { open(code); return; }
    if (autosave.hasPending() || update.revision <= lastRevision) return;
    lastRevision = update.revision;
    restore(update);
    persist(false);
  };
  stopWatch = watchForm(code, receive);
  // Recupera avisos persistidos mesmo se a conexão ao vivo ficar indisponível.
  poll = setInterval(() => loadForm(code).then(receive).catch(() => {}), 30000);
  if (editingLocked) autosave.stop();
  else if (dirty || edits > 0) autosave(read());
}
function capture(event) {
  if (!activeCode || editingLocked || event.target.id === 'comite') return;
  if (event.type !== 'voting-change' && !event.target.matches('#veto,#sem-veto,.paises-veto input,.crise,.detalhamentocrise,.comentarios,#votacao input,#proposal')) return;
  edits++;
  persist(true);
  autosave?.(read());
}
document.addEventListener('input', capture);
document.addEventListener('change', capture);
document.addEventListener('voting-change', capture);
$('comite').addEventListener('change', () => open($('comite').value));
window.addEventListener('beforeunload', event => {
  if (autosave?.hasPending() && !localSaved) { event.preventDefault(); event.returnValue = ''; }
});
const requested = new URL(location.href).searchParams.get('comite');
const initial = committeeByCode(requested) ? requested : store.lastCommittee();
disableFields();
await refreshEditing();
setInterval(refreshEditing, 30000);
if (initial) await open(initial);


