import { COUNTRIES, committeeByCode } from './committees.js';
import { normalizeVoting } from './voting.js';

const prefix = 'minionu-form.v1.';
const selectedKey = 'minionu-last-committee';
function validateForm(form, code) {
  const committee = committeeByCode(code);
  if (!committee || !form || form.committee !== code || typeof form.hasVeto !== 'boolean') return null;
  if (typeof form.crisisTitle !== 'string' || typeof form.crisisDetails !== 'string' || form.crisisTitle.length > 500 || form.crisisDetails.length > 5000) return null;
  const state = form.state;
  if (!state || !Array.isArray(state.vetoCountries) || state.vetoCountries.some(country => !COUNTRIES.includes(country)) || !Array.isArray(state.delegations)) return null;
  const expected = COUNTRIES.slice(0, committee.countries);
  if (state.delegations.length !== expected.length || expected.some(country => state.delegations.filter(d => d?.country === country).length !== 1)) return null;
  const delegations = expected.map(country => {
    const delegation = state.delegations.find(d => d.country === country);
    if (!['', 'favoravel', 'abstido', 'contra'].includes(delegation.vote) || typeof delegation.comment !== 'string' || delegation.comment.length > 4000) throw new Error('Dados locais inválidos.');
    return { country, vote: delegation.vote, comment: delegation.comment };
  });
  return { committee: code, resetEpoch: typeof form.resetEpoch === 'string' ? form.resetEpoch : '', hasVeto: form.hasVeto, crisisTitle: form.crisisTitle, crisisDetails: form.crisisDetails,
    state: { vetoCountries: state.vetoCountries, delegations, voting: normalizeVoting(state.voting, code) } };
}
export function createFormStore(storage) {
  return {
    read(code) {
      if (!committeeByCode(code)) return null;
      for (const key of [prefix + code, 'minionu-draft.' + code]) {
        try {
          const raw = storage?.getItem(key);
          if (!raw) continue;
          const record = JSON.parse(raw);
          const form = validateForm(record.form || record, code);
          if (form) return { form, dirty: record.form ? record.dirty !== false : true, revision: Number.isInteger(record.revision) ? record.revision : -1 };
        } catch { /* Um dado inválido não impede abrir o restante do site. */ }
      }
      return null;
    },
    save(code, form, { dirty = true, revision = -1 } = {}) {
      if (!storage || !committeeByCode(code)) return false;
      try {
        storage.setItem(prefix + code, JSON.stringify({ version: 1, form, dirty, revision, savedAt: new Date().toISOString() }));
        // Migra o rascunho antigo somente depois de salvar a cópia permanente.
        storage.removeItem('minionu-draft.' + code);
        return true;
      } catch { return false; }
    },
    rememberCommittee(code) {
      if (!storage || !committeeByCode(code)) return false;
      try { storage.setItem(selectedKey, code); return true; } catch { return false; }
    },
    lastCommittee() {
      try { const code = storage?.getItem(selectedKey); return committeeByCode(code) ? code : null; } catch { return null; }
    }
  };
}
