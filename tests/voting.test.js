import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMITTEES, COUNTRIES, emptyForm, VOTING_RULES } from '../committees.js';
import { calculateVote } from '../voting.js';

// Allocate negative votes to non-permanent members first so threshold tests
// exercise the majority rule independently from the Security Council veto.
function ballot(code, favoravel, contra, pending = 0) {
  const form = emptyForm(code);
  const ordered = [...form.state.delegations].sort((a, b) =>
    Number(VOTING_RULES[code].vetoCountries.includes(a.country)) -
    Number(VOTING_RULES[code].vetoCountries.includes(b.country)));
  ordered.forEach((delegation, index) => {
    delegation.vote = index < contra ? 'contra' : index < contra + favoravel ? 'favoravel' : 'abstido';
  });
  ordered.slice(-pending || ordered.length).forEach(delegation => { delegation.vote = ''; });
  return form.state.delegations;
}

test('committee criteria and delegation rosters preserve the original CodePen', () => {
  const majorityByCode = {
    CSNU: '3/5', OMS: '2/3', UNESCO: '2/3',
    CDH: 'simples', ONUM: 'simples', UNICEF: 'simples', CDESC: 'simples', ACNUR: 'simples'
  };
  for (const committee of COMMITTEES) {
    assert.equal(VOTING_RULES[committee.code].majority, majorityByCode[committee.code]);
    assert.deepEqual(emptyForm(committee.code).state.delegations.map(d => d.country), COUNTRIES.slice(0, committee.countries));
  }
  assert.deepEqual(VOTING_RULES.CSNU.paisesVeto, ['EUA', 'RUSSIA', 'CHINA', 'FRANCA', 'REINO UNIDO']);
  assert.deepEqual(VOTING_RULES.CSNU.vetoCountries, ['Rússia', 'EUA', 'China', 'França']);
  assert.equal(emptyForm('CSNU').hasVeto, true);
  assert.equal(emptyForm('CDH').hasVeto, false);
});

test('simple majority requires strictly more yes votes than no votes, excluding abstentions', () => {
  for (const code of ['CDH', 'ONUM', 'UNICEF', 'CDESC', 'ACNUR']) {
    const total = emptyForm(code).state.delegations.length;
    for (let yes = 0; yes <= total; yes++) {
      for (let no = 0; no <= total - yes; no++) {
        const result = calculateVote(code, ballot(code, yes, no));
        assert.equal(result.status, yes > no ? 'approved' : 'denied', `${code}: ${yes} yes, ${no} no`);
        assert.deepEqual(result.counts, { favoravel: yes, contra: no, abstido: total - yes - no, pending: 0 });
        assert.equal(result.requiredVotes, Math.floor((yes + no) / 2) + 1);
      }
    }
  }
});

test('two thirds rounds up and accepts exact fractions', () => {
  for (const code of ['OMS', 'UNESCO']) {
    for (const [yes, no, required, status] of [
      [6, 3, 6, 'approved'], [5, 4, 6, 'denied'],
      [2, 1, 2, 'approved'], [2, 2, 3, 'denied'],
      [3, 1, 3, 'approved'], [1, 0, 1, 'approved']
    ]) {
      const result = calculateVote(code, ballot(code, yes, no));
      assert.equal(result.requiredVotes, required, `${code}: ${yes} yes, ${no} no`);
      assert.equal(result.status, status);
      assert.equal(result.validVotes, yes + no);
    }
  }
});

test('three fifths rounds up and excludes abstentions', () => {
  for (const [yes, no, required, status] of [
    [6, 3, 6, 'approved'], [5, 4, 6, 'denied'],
    [3, 2, 3, 'approved'], [2, 2, 3, 'denied'],
    [2, 1, 2, 'approved']
  ]) {
    const result = calculateVote('CSNU', ballot('CSNU', yes, no));
    assert.equal(result.requiredVotes, required);
    assert.equal(result.status, status, `${yes} yes, ${no} no`);
    assert.deepEqual(result.vetoedBy, []);
  }
});

test('all-abstention ballots are denied for every rule', () => {
  for (const { code } of COMMITTEES) {
    const result = calculateVote(code, ballot(code, 0, 0));
    assert.equal(result.status, 'denied', code);
    assert.equal(result.validVotes, 0);
    assert.equal(result.requiredVotes, 1);
  }
});

test('normalized permanent members veto even an otherwise passing vote', () => {
  for (const country of ['Rússia', 'EUA', 'China', 'França']) {
    const delegations = ballot('CSNU', 9, 0);
    delegations.find(d => d.country === country).vote = 'contra';
    const result = calculateVote('CSNU', delegations);
    assert.equal(result.status, 'vetoed', country);
    assert.equal(result.counts.favoravel, 8);
    assert.deepEqual(result.vetoedBy, [country]);
  }
});

test('permanent member abstentions and negative votes outside CSNU do not veto', () => {
  const delegations = ballot('CSNU', 9, 0);
  delegations.find(d => d.country === 'Rússia').vote = 'abstido';
  assert.equal(calculateVote('CSNU', delegations).status, 'approved');
  const nonCouncil = ballot('CDH', 9, 0);
  nonCouncil.find(d => d.country === 'Rússia').vote = 'contra';
  assert.equal(calculateVote('CDH', nonCouncil).status, 'approved');
});

test('incomplete ballots remain pending even when a veto is already cast', () => {
  const delegations = ballot('CSNU', 8, 0, 1);
  delegations.find(d => d.country === 'Rússia').vote = 'contra';
  const result = calculateVote('CSNU', delegations);
  assert.equal(result.status, 'pending');
  assert.equal(result.counts.pending, 1);
  assert.deepEqual(result.vetoedBy, ['Rússia']);
  assert.equal(calculateVote('CDH').counts.pending, 9);
});

test('missing, duplicate, and unknown ballots cannot silently finish a vote', () => {
  const delegations = ballot('CDH', 9, 0);
  assert.equal(calculateVote('CDH', delegations.slice(1)).status, 'pending');
  assert.equal(calculateVote('CDH', [...delegations, delegations[0]]).status, 'pending');
  const invalid = structuredClone(delegations);
  invalid[0].vote = 'approved';
  assert.equal(calculateVote('CDH', invalid).status, 'pending');
  const extra = [...delegations, { country: 'Outro país', vote: 'contra' }];
  assert.equal(calculateVote('CDH', extra).counts.contra, 0);
  assert.throws(() => calculateVote('UNKNOWN', delegations), /Comitê inválido/);
});
