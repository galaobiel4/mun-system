import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { RoomLiveUpdates } from '../backend/src/index.js';
import { calculateVote, normalizeVoting } from '../voting.js';
import { COUNTRIES, emptyForm } from '../committees.js';

const votes = (favoravel, contra, abstido, unmarked = 0) =>
  [...Array(favoravel).fill('favoravel'), ...Array(contra).fill('contra'), ...Array(abstido).fill('abstido'), ...Array(unmarked).fill('')]
    .map((vote, index) => ({ country: COUNTRIES[index], vote }));
const record = (ballot, visualDecision = '', configuration = {}) => ({
  id: crypto.randomUUID(), recordedAt: '2026-10-08T20:00:00.000Z', proposal: 'Proposta de teste',
  votes: ballot, hasVeto: false, vetoCountries: [], visualDecision, ...configuration
});

test('maioria simples exclui abstenções, recusa empate e não aprova sem votos', () => {
  assert.equal(calculateVote('CDH', votes(2, 1, 6)).result, 'approved');
  assert.equal(calculateVote('CDH', votes(4, 4, 1)).result, 'rejected');
  assert.equal(calculateVote('CDH', votes(0, 0, 9)).result, 'rejected');
});
test('2/3 usa votos afirmativos e negativos, com arredondamento para cima', () => {
  assert.equal(calculateVote('OMS', votes(2, 1, 6)).result, 'approved');
  assert.equal(calculateVote('UNESCO', votes(3, 2, 4)).result, 'rejected');
  assert.equal(calculateVote('UNESCO', votes(4, 2, 3)).result, 'approved');
  assert.equal(calculateVote('OMS', votes(0, 0, 9)).result, 'rejected');
});
test('CSNU exige 3/5 de todos os membros, não só dos votantes', () => {
  assert.equal(calculateVote('CSNU', votes(5, 0, 5)).result, 'rejected');
  assert.equal(calculateVote('CSNU', votes(6, 0, 4)).result, 'approved');
});
test('veto bloqueia maioria; abstenção de membro com veto permite aprovação', () => {
  const ballot = votes(8, 0, 2);
  ballot[1].vote = 'contra';
  assert.equal(calculateVote('CSNU', ballot, { hasVeto: true, vetoCountries: ['Rússia'] }).result, 'rejected');
  ballot[1].vote = 'abstido';
  assert.equal(calculateVote('CSNU', ballot, { hasVeto: true, vetoCountries: ['Rússia'] }).result, 'approved');
  ballot[1].vote = 'contra';
  assert.equal(calculateVote('CSNU', ballot, { hasVeto: false, vetoCountries: ['Rússia'] }).result, 'approved');
});
test('votos não marcados ficam pendentes; contraste decide sem votos individuais', () => {
  assert.equal(calculateVote('CDH', votes(5, 3, 0, 1)).result, 'pending');
  for (const visualDecision of ['approved', 'rejected']) {
    const outcome = calculateVote('CSNU', votes(0, 0, 0, 9), { visualDecision });
    assert.equal(outcome.result, visualDecision);
    assert.equal(outcome.method, 'visual');
  }
});
test('veto tem prioridade sobre aprovação por contraste visual', () => {
  const outcome = calculateVote('CSNU', votes(0, 9, 0), { visualDecision: 'approved', hasVeto: true, vetoCountries: ['Rússia'] });
  assert.equal(outcome.result, 'rejected');
  assert.deepEqual(outcome.vetoes, ['Rússia']);
});
test('um voto de veto recusa imediatamente e permite registro com países ainda não marcados', () => {
  for (const country of ['EUA', 'Rússia', 'China', 'França', 'Reino Unido']) {
    const ballot = votes(0, 0, 0, 10);
    ballot.find(vote => vote.country === country).vote = 'contra';
    const configuration = { hasVeto: true, vetoCountries: [country] };
    const outcome = calculateVote('CSNU', ballot, configuration);
    assert.equal(outcome.result, 'rejected');
    assert.equal(outcome.tally.unmarked, 9);
    assert.deepEqual(outcome.vetoes, [country]);
    const normalized = normalizeVoting({ proposal: '', visualDecision: '', history: [record(ballot, '', configuration)] }, 'CSNU');
    assert.equal(normalized.history[0].result, 'rejected');
  }
});
test('histórico antigo do CSNU conserva os nove votos anteriores à inclusão do Reino Unido', () => {
  const old = record(votes(6, 0, 3), '', { hasVeto: true, vetoCountries: ['Rússia'] });
  const normalized = normalizeVoting({ proposal: '', visualDecision: '', history: [old] }, 'CSNU');
  assert.equal(normalized.history[0].votes.length, 9);
  assert.equal(normalized.history[0].result, 'approved');
});
test('abstenção ou voto contrário sem veto continuam aguardando os demais países', () => {
  const ballot = votes(0, 0, 0, 9);
  ballot[1].vote = 'abstido';
  assert.equal(calculateVote('CSNU', ballot, { hasVeto: true, vetoCountries: ['Rússia'] }).result, 'pending');
  ballot[0].vote = 'contra';
  assert.equal(calculateVote('CSNU', ballot, { hasVeto: true, vetoCountries: ['Rússia'] }).result, 'pending');
});
test('UNICEF conta a décima delegação', () => {
  assert.equal(calculateVote('UNICEF', votes(5, 5, 0)).result, 'rejected');
  assert.equal(calculateVote('UNICEF', votes(6, 4, 0)).result, 'approved');
});
test('histórico antigo e vazio permanece compatível', () => {
  assert.deepEqual(normalizeVoting(undefined, 'CDH'), { proposal: '', visualDecision: '', history: [] });
});
test('validação recalcula resultados e conserva proposta, data e votos', () => {
  const ballot = record(votes(1, 8, 0));
  ballot.result = 'approved';
  const normalized = normalizeVoting({ proposal: 'Próxima proposta', visualDecision: '', history: [ballot] }, 'CDH');
  assert.equal(normalized.history[0].result, 'rejected');
  assert.equal(normalized.history[0].proposal, ballot.proposal);
  assert.deepEqual(normalized.history[0].votes, ballot.votes);
});
test('validação aceita contraste sem votos e rejeita entradas incompletas ou duplicadas', () => {
  const visual = record(votes(0, 0, 0, 9), 'approved');
  assert.equal(normalizeVoting({ proposal: '', visualDecision: '', history: [visual] }, 'CSNU').history[0].result, 'approved');
  const incomplete = record(votes(5, 0, 0, 4));
  assert.throws(() => normalizeVoting({ proposal: '', visualDecision: '', history: [incomplete] }, 'CDH'), /Complete/);
  assert.throws(() => normalizeVoting({ proposal: '', visualDecision: '', history: [visual, visual] }, 'CSNU'), /repetido/);
});
test('API mantém os campos e devolve 400 para votos históricos inválidos', async () => {
  const env = {
    ALLOWED_ORIGINS: 'http://localhost:5500',
    ROOMS: { idFromName: value => value, get: () => ({ fetch: async request => Response.json(await request.json()) }) }
  };
  const form = emptyForm('CDH');
  form.state.voting = { proposal: 'Proposta atual', visualDecision: 'approved', history: [record(votes(0, 0, 0, 9), 'approved')] };
  const request = () => new Request('https://local.test/api/committees/CDH', {
    method: 'PUT', headers: { Origin: 'http://localhost:5500', 'content-type': 'application/json' }, body: JSON.stringify(form)
  });
  const response = await worker.fetch(request(), env);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).state.voting.history[0].result, 'approved');
  form.state.voting.history[0].votes[0].vote = 'inválido';
  assert.equal((await worker.fetch(request(), env)).status, 400);
});
test('salvar formulário antigo não apaga registros e dois registros simultâneos são conservados', async () => {
  let row = { code: 'CDH', form_json: JSON.stringify(emptyForm('CDH')), revision: 0, created_at: '2026-10-08T00:00:00.000Z', updated_at: '2026-10-08T00:00:00.000Z' };
  const env = {
    DB: {
      prepare: sql => ({ sql, first: async () => null, bind: (...values) => ({ sql, values, first: async () => ({ ...row }) }) }),
      batch: async statements => {
        const update = statements.find(statement => statement.sql.startsWith('UPDATE'));
        if (update) row = { ...row, form_json: update.values[0], revision: update.values[1], updated_at: update.values[2] };
        return statements.map(() => ({ meta: { changes: 1 } }));
      }
    },
    DASHBOARD: { idFromName: value => value, get: () => ({ fetch: async () => Response.json({ ok: true }) }) }
  };
  const room = new RoomLiveUpdates({ getWebSockets: () => [] }, env);
  const save = form => room.fetch(new Request('https://local.test/save', {
    method: 'POST', headers: { 'x-committee-code': 'CDH', 'content-type': 'application/json' }, body: JSON.stringify(form)
  }));
  const first = emptyForm('CDH');
  first.state.voting.history.push(record(votes(5, 4, 0)));
  const second = emptyForm('CDH');
  second.state.voting.history.push(record(votes(4, 5, 0)));
  await Promise.all([save(first), save(second)]);
  assert.equal(JSON.parse(row.form_json).state.voting.history.length, 2);
  await save(emptyForm('CDH'));
  assert.equal(JSON.parse(row.form_json).state.voting.history.length, 2);
});
