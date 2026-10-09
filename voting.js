import { COUNTRIES, committeeByCode } from './committees.js';

export const MAX_VOTATIONS = 1000;
export const VOTE_LABELS = { '': 'Não marcado', favoravel: 'Favorável', abstido: 'Abstido', contra: 'Contra' };

// Usado também pela API: resultados do histórico são calculados a partir dos votos.
export function normalizeVoting(value, code) {
  if (value === undefined) return { proposal: '', visualDecision: '', history: [] };
  if (!value || typeof value !== 'object') throw new Error('Dados da votação inválidos.');
  const string = (text, max = 2000) => {
    if (typeof text !== 'string' || text.length > max) throw new Error('Texto da proposta inválido ou acima do limite.');
    return text;
  };
  const visual = decision => {
    if (!['', 'approved', 'rejected'].includes(decision)) throw new Error('Contraste visual inválido.');
    return decision;
  };
  if (!Array.isArray(value.history) || value.history.length > MAX_VOTATIONS) throw new Error('Histórico de votações inválido ou acima do limite.');
  const countries = COUNTRIES.slice(0, committeeByCode(code).countries);
  const ids = new Set();
  const history = value.history.map(record => {
    if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !/^[a-f0-9-]{36}$/i.test(record.id) || ids.has(record.id)) throw new Error('Identificador da votação inválido ou repetido.');
    ids.add(record.id);
    const proposal = string(record.proposal).trim();
    if (!proposal) throw new Error('Informe a proposta votada.');
    if (typeof record.recordedAt !== 'string' || record.recordedAt.length > 40 || !Number.isFinite(Date.parse(record.recordedAt))) throw new Error('Data da votação inválida.');
    if (typeof record.hasVeto !== 'boolean' || !Array.isArray(record.vetoCountries) || record.vetoCountries.some(country => !COUNTRIES.includes(country))) throw new Error('Configuração de veto inválida.');
    // Os registros anteriores à inclusão do Reino Unido preservam sua composição original.
    const recordCountries = code === 'CSNU' && Array.isArray(record.votes) && record.votes.length === 9 ? COUNTRIES.slice(0, 9) : countries;
    if (!Array.isArray(record.votes) || record.votes.length !== recordCountries.length || recordCountries.some(country => record.votes.filter(vote => vote?.country === country).length !== 1)) throw new Error('Lista de votos inválida.');
    const votes = recordCountries.map(country => {
      const vote = record.votes.find(vote => vote.country === country).vote;
      if (!Object.hasOwn(VOTE_LABELS, vote)) throw new Error('Voto inválido.');
      return { country, vote };
    });
    const configuration = { hasVeto: record.hasVeto, vetoCountries: COUNTRIES.filter(country => record.vetoCountries.includes(country)), visualDecision: visual(record.visualDecision) };
    const outcome = calculateForCountries(code, votes, configuration, recordCountries);
    if (outcome.result === 'pending') throw new Error('Complete os votos ou escolha o contraste visual antes de registrar.');
    return { id: record.id, recordedAt: new Date(record.recordedAt).toISOString(), proposal, votes, ...configuration, ...outcome };
  });
  return { proposal: string(value.proposal), visualDecision: visual(value.visualDecision), history };
}

export function calculateVote(code, votes, options = {}) {
  return calculateForCountries(code, votes, options, COUNTRIES.slice(0, committeeByCode(code)?.countries));
}
function calculateForCountries(code, votes, options, countries) {
  const committee = committeeByCode(code);
  if (!committee) throw new Error('Comitê inválido.');
  const tally = { favoravel: 0, abstido: 0, contra: 0, unmarked: 0 };
  for (const country of countries) {
    const value = votes.find(vote => vote.country === country)?.vote;
    if (['favoravel', 'abstido', 'contra'].includes(value)) tally[value]++;
    else tally.unmarked++;
  }
  const majority = committee.majority || 'simples';
  // Regra 86 da Assembleia Geral: abstenções não integram os membros votantes.
  // Artigo 27: no CSNU o mínimo se refere ao total de membros; abstenção não veta.
  const basis = code === 'CSNU' ? countries.length : tally.favoravel + tally.contra;
  const required = majority === 'simples'
    ? Math.floor(basis / 2) + 1
    : Math.max(1, Math.ceil(basis * (majority === '2/3' ? 2 / 3 : 3 / 5)));
  const vetoes = options.hasVeto
    ? votes.filter(vote => countries.includes(vote.country) && options.vetoCountries?.includes(vote.country) && vote.vote === 'contra').map(vote => vote.country)
    : [];
  // O veto recusa a proposta imediatamente, mesmo com votos pendentes ou contraste visual.
  if (vetoes.length) return { result: 'rejected', method: 'countries', majority, required, basis, tally, vetoes };
  if (options.visualDecision === 'approved' || options.visualDecision === 'rejected') {
    return { result: options.visualDecision, method: 'visual', majority, required, basis, tally, vetoes: [] };
  }
  const result = tally.unmarked ? 'pending'
    : tally.favoravel >= required ? 'approved' : 'rejected';
  return { result, method: 'countries', majority, required, basis, tally, vetoes };
}
