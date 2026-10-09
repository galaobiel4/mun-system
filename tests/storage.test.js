import test from 'node:test';
import assert from 'node:assert/strict';
import { createFormStore } from '../storage.js';
import { emptyForm } from '../committees.js';

function memoryStorage() {
  const data = new Map();
  return { data, getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: key => data.delete(key) };
}
test('guarda permanentemente informações completas, mesmo após confirmar envio', () => {
  const storage = memoryStorage(), store = createFormStore(storage);
  const form = emptyForm('ONUM');
  form.crisisTitle = 'Crise de teste';
  form.crisisDetails = 'Encaminhamento da crise';
  form.state.delegations[0].comment = 'Comentário sobre o Brasil';
  form.state.delegations[0].vote = 'favoravel';
  form.state.voting.proposal = 'Proposta em discussão';
  form.state.voting.visualDecision = 'approved';
  assert.equal(store.save('ONUM', form), true);
  assert.equal(store.read('ONUM').dirty, true);
  store.save('ONUM', form, { dirty: false, revision: 3 });
  const restored = createFormStore(storage).read('ONUM');
  assert.deepEqual(restored.form, form);
  assert.equal(restored.dirty, false);
  assert.equal(restored.revision, 3);
  assert.ok(storage.data.has('minionu-form.v1.ONUM'));
});
test('histórico é conservado na cópia local com todos os votos e proposta', () => {
  const store = createFormStore(memoryStorage()), form = emptyForm('CDH');
  form.state.voting.history.push({
    id: crypto.randomUUID(), recordedAt: '2026-10-08T23:00:00.000Z',
    proposal: 'Proposta decidida por contraste', votes: form.state.delegations.map(({ country, vote }) => ({ country, vote })),
    hasVeto: false, vetoCountries: [], visualDecision: 'approved'
  });
  store.save('CDH', form, { dirty: false });
  const restored = store.read('CDH').form.state.voting.history[0];
  assert.equal(restored.result, 'approved');
  assert.equal(restored.proposal, 'Proposta decidida por contraste');
  assert.equal(restored.votes.length, 9);
});
test('os formulários ficam separados por comitê e lembra o último escolhido', () => {
  const store = createFormStore(memoryStorage());
  const cdh = emptyForm('CDH'), oms = emptyForm('OMS');
  cdh.crisisTitle = 'CDH'; oms.crisisTitle = 'OMS';
  store.save('CDH', cdh); store.save('OMS', oms); store.rememberCommittee('OMS');
  assert.equal(store.read('CDH').form.crisisTitle, 'CDH');
  assert.equal(store.read('OMS').form.crisisTitle, 'OMS');
  assert.equal(store.lastCommittee(), 'OMS');
  assert.equal(store.rememberCommittee('INVALIDO'), false);
  assert.equal(store.lastCommittee(), 'OMS');
});
test('migra rascunho antigo sem perder dados e limpa apenas a chave antiga', () => {
  const storage = memoryStorage(), form = emptyForm('CDH');
  form.crisisTitle = 'Rascunho antigo';
  storage.setItem('minionu-draft.CDH', JSON.stringify(form));
  const store = createFormStore(storage), restored = store.read('CDH');
  assert.equal(restored.dirty, true);
  assert.equal(restored.form.crisisTitle, 'Rascunho antigo');
  store.save('CDH', restored.form);
  assert.equal(storage.getItem('minionu-draft.CDH'), null);
  assert.equal(store.read('CDH').form.crisisTitle, 'Rascunho antigo');
  const oldCSNU = emptyForm('CSNU'); oldCSNU.state.delegations.pop(); oldCSNU.state.delegations[1].comment = 'Comentário anterior';
  storage.setItem('minionu-draft.CSNU', JSON.stringify(oldCSNU));
  const csnu = store.read('CSNU').form;
  assert.equal(csnu.state.delegations.length, 10);
  assert.equal(csnu.state.delegations[1].comment, 'Comentário anterior');
  assert.deepEqual(csnu.state.delegations[9], { country: 'Reino Unido', vote: '', comment: '' });
});
test('JSON inválido e cópia de outro comitê não quebram a página', () => {
  const storage = memoryStorage(), store = createFormStore(storage);
  storage.setItem('minionu-form.v1.CDH', '{quebrado');
  assert.equal(store.read('CDH'), null);
  storage.setItem('minionu-form.v1.CDH', JSON.stringify({ form: emptyForm('OMS') }));
  assert.equal(store.read('CDH'), null);
  storage.setItem('minionu-draft.CDH', JSON.stringify(emptyForm('CDH')));
  assert.ok(store.read('CDH'));
});
test('armazenamento bloqueado ou sem espaço não lança erro nem apaga o rascunho', () => {
  const blocked = { getItem: () => { throw new Error('Blocked'); }, setItem: () => { throw new Error('QuotaExceeded'); }, removeItem: () => { throw new Error('Blocked'); } };
  const store = createFormStore(blocked);
  assert.equal(store.save('CDH', emptyForm('CDH')), false);
  assert.equal(store.read('CDH'), null);
  assert.equal(store.rememberCommittee('CDH'), false);
  assert.equal(store.lastCommittee(), null);
  assert.equal(createFormStore(undefined).save('CDH', emptyForm('CDH')), false);
});
