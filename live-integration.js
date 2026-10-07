import { createRoom, loadRoom, createAutosave } from './client.js';
const $ = id => document.getElementById(id);
const VETO_COUNTRIES = {brasil:'Brasil',india:'Índia',eua:'EUA',turquia:'Turquia',russia:'Rússia',china:'China',nigeria:'Nigéria',alemanha:'Alemanha',franca:'França',uk:'Reino Unido'};
const CREDENTIALS = 'minionu-editor-room', DRAFT = 'minionu-form-draft';
let credentials, autosave;
const setStatus = (text, status = '') => { $('sync-status').textContent = text; $('sync-status').dataset.status = status; };

function readForm() {
  return {
    committee: $('comite').value, hasVeto: $('veto').checked,
    crisisTitle: document.querySelector('.crise').value,
    crisisDetails: document.querySelector('.detalhamentocrise').value,
    state: {
      vetoCountries: Object.entries(VETO_COUNTRIES).filter(([id]) => $(id).checked).map(([, country]) => country),
      delegations: [...document.querySelectorAll('#pais details')].map(detail => {
        const country = detail.querySelector('summary').textContent.trim();
        const vote = [...document.querySelectorAll('#votacao input:checked')].find(input => input.name === `${country}voto`)?.value || '';
        return { country, comment: detail.querySelector('.comentarios').value, vote };
      })
    }
  };
}
function restoreForm(room) {
  $('comite').value = room.committee || '';
  if (room.committee) window.selecao(room.committee);
  else { $('pais').replaceChildren(); $('votacao').replaceChildren(); }
  $('veto').checked = room.hasVeto === true; $('sem-veto').checked = !room.hasVeto;
  document.querySelector('.crise').value = room.crisisTitle || '';
  document.querySelector('.detalhamentocrise').value = room.crisisDetails || '';
  for (const [id, country] of Object.entries(VETO_COUNTRIES)) $(id).checked = (room.state?.vetoCountries || []).includes(country);
  for (const detail of document.querySelectorAll('#pais details')) {
    const country = detail.querySelector('summary').textContent.trim();
    const delegation = room.state?.delegations?.find(d => d.country === country);
    if (!delegation) continue;
    detail.querySelector('.comentarios').value = delegation.comment || '';
    for (const input of document.querySelectorAll('#votacao input')) if (input.name === `${country}voto`) input.checked = input.value === delegation.vote;
  }
}
function activate(roomCredentials) {
  autosave?.stop(); credentials = roomCredentials;
  localStorage.setItem(CREDENTIALS, JSON.stringify(credentials));
  $('room-id').value = credentials.id; $('room-key').value = credentials.accessKey;
  if (credentials.watchKey) {
    const url = new URL('supervisor.html', location.href);
    url.hash = new URLSearchParams({ room: credentials.id, key: credentials.watchKey }).toString();
    $('supervisor-link').value = url.href; $('open-supervisor').href = url.href; $('room-sharing').hidden = false;
  } else $('room-sharing').hidden = true;
  autosave = createAutosave(credentials.id, credentials.accessKey, (status, error) => {
    const labels = { pending: 'Alteração aguardando envio…', saving: 'Enviando atualização…', saved: 'Alterações salvas e enviadas ao painel de supervisão.', error: `${error || 'Sem conexão.'} O envio será tentado novamente.` };
    setStatus(labels[status], status);
  });
  setStatus('Sala conectada. Alterações serão enviadas automaticamente.', 'saved');
}
async function openRoom(id, key, cached) {
  const room = await loadRoom(id, key);
  if (room.role !== 'editor') throw new Error('Use a chave de edição para abrir o formulário; a chave de supervisão abre o painel.');
  restoreForm(room); activate({ id, accessKey: key, watchKey: cached?.watchKey });
}
function capture(event) {
  if (!event.target.matches('#comite,#veto,#sem-veto,.paises-veto input,.crise,.detalhamentocrise,.comentarios,#votacao input')) return;
  const snapshot = readForm();
  localStorage.setItem(DRAFT, JSON.stringify(snapshot));
  if (autosave) autosave(snapshot);
}
document.addEventListener('input', capture);
document.addEventListener('change', capture);
$('create-room').addEventListener('click', async () => {
  if (autosave?.hasPending()) { setStatus('Aguarde o envio pendente antes de criar outra sala.', 'error'); return; }
  $('create-room').disabled = true; setStatus('Criando sala…');
  try { const room = await createRoom(readForm()); activate({ id: room.id, accessKey: room.accessKey, watchKey: room.watchKey }); }
  catch (error) { setStatus(error.message, 'error'); }
  finally { $('create-room').disabled = false; }
});
$('join-room').addEventListener('click', async () => {
  if (autosave?.hasPending()) { setStatus('Aguarde o envio pendente antes de trocar de sala.', 'error'); return; }
  const id = $('room-id').value.trim(), key = $('room-key').value.trim();
  if (!id || !key) { setStatus('Informe ID e chave de edição.', 'error'); return; }
  $('join-room').disabled = true; setStatus('Abrindo sala…');
  try { await openRoom(id, key, credentials?.id === id ? credentials : undefined); }
  catch (error) { setStatus(error.message, 'error'); }
  finally { $('join-room').disabled = false; }
});
$('copy-supervisor').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText($('supervisor-link').value); setStatus('Link de supervisão copiado.', 'saved'); }
  catch { $('supervisor-link').select(); setStatus('Selecione e copie o link exibido.'); }
});
window.addEventListener('beforeunload', event => { if (autosave?.hasPending()) { event.preventDefault(); event.returnValue = ''; } });
try {
  const draft = JSON.parse(localStorage.getItem(DRAFT) || 'null'); if (draft) restoreForm(draft);
  const cached = JSON.parse(localStorage.getItem(CREDENTIALS) || 'null');
  if (cached) { credentials = cached; await openRoom(cached.id, cached.accessKey, cached); }
} catch (error) { setStatus(`${error.message} Seus dados locais continuam no formulário.`, 'error'); }
