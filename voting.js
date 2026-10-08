import { COUNTRIES, committeeByCode, VOTING_RULES } from './committees.js';

export { VOTING_RULES };

export function calculateVote(code, delegations = []) {
  const rule = VOTING_RULES[code], committee = committeeByCode(code);
  if (!rule || !committee) throw new Error('Comitê inválido.');
  const counts = { favoravel: 0, contra: 0, abstido: 0, pending: 0 }, vetoedBy = [];
  for (const country of COUNTRIES.slice(0, committee.countries)) {
    const votes = delegations.filter(delegation => delegation?.country === country);
    const vote = votes.length === 1 ? votes[0].vote : '';
    if (['favoravel', 'contra', 'abstido'].includes(vote)) counts[vote]++;
    else counts.pending++;
    if (vote === 'contra' && rule.vetoCountries.includes(country)) vetoedBy.push(country);
  }
  const validVotes = counts.favoravel + counts.contra;
  const [numerator, denominator] = rule.majority.split('/').map(Number);
  const requiredVotes = rule.majority === 'simples' ? Math.floor(validVotes / 2) + 1 : Math.max(1, Math.ceil(validVotes * numerator / denominator));
  const status = counts.pending ? 'pending' : vetoedBy.length ? 'vetoed' : validVotes > 0 && counts.favoravel >= requiredVotes ? 'approved' : 'denied';
  return { status, counts, requiredVotes, validVotes, vetoedBy, majority: rule.majority };
}
