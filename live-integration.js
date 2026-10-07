import { loadForm, watchForm, createAutosave } from './client.js';
import { committeeByCode, emptyForm } from './committees.js';
const $ = id => document.getElementById(id);
const VETO = {brasil:'Brasil',india:'Índia',eua:'EUA',turquia:'Turquia',russia:'Rússia',china:'China',nigeria:'Nigéria',alemanha:'Alemanha',franca:'França',uk:'Reino Unido'};
let activeCode, autosave, stopWatch, loading = false, generation = 0, lastRevision = -1;
const status = (message, state = '') => { $('sync-status').textContent = message; $('sync-status').dataset.status = state; };
const draftKey = code => `minionu-draft.${code}`;
function read() {
  return { committee: activeCode, hasVeto: $('veto').checked, crisisTitle: document.querySelector('.crise').value, crisisDetails: document.querySelector('.detalhamentocrise').value,
    state: { vetoCountries: Object.entries(VETO).filter(([id]) => $(id).checked).map(([, name]) => name), delegations: [...document.querySelectorAll('#pais details')].map(detail => { const country = detail.querySelector('summary').textContent.trim(); return { country, comment: detail.querySelector('.comentarios').value, vote: [...document.querySelectorAll('#votacao input:checked')].find(input => input.name === `${country}voto`)?.value || '' }; }) } };
}
function restore(form) {
  $('comite').value = form.committee; window.selecao(form.committee);
  $('veto').checked = form.hasVeto; $('sem-veto').checked = !form.hasVeto;
  document.querySelector('.crise').value = form.crisisTitle; document.querySelector('.detalhamentocrise').value = form.crisisDetails;
  document.querySelector('.crise').maxLength = 500; document.querySelector('.detalhamentocrise').maxLength = 5000;
  for (const [id, country] of Object.entries(VETO)) $(id).checked = form.state.vetoCountries.includes(country);
  for (const detail of document.querySelectorAll('#pais details')) {
    const country = detail.querySelector('summary').textContent.trim(), d = form.state.delegations.find(d => d.country === country);
    detail.querySelector('textarea').maxLength = 4000; detail.querySelector('textarea').value = d?.comment || '';
    for (const input of document.querySelectorAll('#votacao input')) if (input.name === `${country}voto`) input.checked = input.value === d?.vote;
  }
}
async function open(code) {
  if (!committeeByCode(code)) return;
  const current = ++generation; loading = true; autosave?.stop(); stopWatch?.(); activeCode = code; lastRevision = -1;
  $('comite').disabled = true; status(`Conectando ${code} ao acompanhamento geral…`);
  const url = new URL(location.href); url.searchParams.set('comite', code); history.replaceState(null, '', url);
  let cached; try { cached = JSON.parse(localStorage.getItem(draftKey(code)) || 'null'); } catch {}
  try { const form = await loadForm(code); if (current !== generation) return; restore(cached || form); lastRevision = form.revision; }
  catch (error) { if (current !== generation) return; restore(cached || emptyForm(code)); status(`${error.message} Alterações serão mantidas neste dispositivo.`, 'error'); }
  if (current !== generation) return;
  loading = false; $('comite').disabled = false;
  autosave = createAutosave(code, (state, error, saved) => {
    if (current !== generation) return;
    if (state === 'saved') { localStorage.removeItem(draftKey(code)); lastRevision = Math.max(lastRevision, saved.revision); }
    const labels = { pending: 'Alteração aguardando envio…', saving: 'Enviando ao painel geral…', saved: `${code}: alterações salvas e enviadas ao painel geral.`, error: `${error} Seus dados locais serão reenviados automaticamente.` };
    status(labels[state], state); $('comite').disabled = state === 'pending' || state === 'saving';
  });
  stopWatch = watchForm(code, update => {
    if (current !== generation || autosave.hasPending() || update.revision <= lastRevision) return;
    lastRevision = update.revision; restore(update);
  }, (state, error) => {
    if (current !== generation || autosave.hasPending()) return;
    if (state === 'connected') status(`${code} conectado. O painel geral já acompanha este formulário.`, 'saved');
    if (state === 'error' || state === 'reconnecting') status(error || 'Sem conexão. Tentando reconectar…', 'error');
  });
  if (cached) autosave(cached);
}
function capture(event) {
  if (loading || !activeCode || event.target.id === 'comite') return;
  if (!event.target.matches('#veto,#sem-veto,.paises-veto input,.crise,.detalhamentocrise,.comentarios,#votacao input')) return;
  const form = read(); localStorage.setItem(draftKey(activeCode), JSON.stringify(form)); autosave?.(form);
}
document.addEventListener('input', capture); document.addEventListener('change', capture);
$('comite').addEventListener('change', () => open($('comite').value));
window.addEventListener('beforeunload', event => { if (autosave?.hasPending()) { event.preventDefault(); event.returnValue = ''; } });
const requested = new URL(location.href).searchParams.get('comite'); if (committeeByCode(requested)) await open(requested);
