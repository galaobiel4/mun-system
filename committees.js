export const COUNTRIES = ['Brasil', 'Rússia', 'EUA', 'Índia', 'China', 'Nigéria', 'Alemanha', 'França', 'Turquia', 'Reino Unido'];
export const COMMITTEES = [
  { code: 'CDH', name: 'Comissão de Direitos Humanos', countries: 9 },
  { code: 'OMS', name: 'Organização Mundial da Saúde', countries: 9 },
  { code: 'UNESCO', name: 'Organização das Nações Unidas para Educação, Ciência e Cultura', countries: 9 },
  { code: 'ONUM', name: 'ONU Mulheres', countries: 9 },
  { code: 'CSNU', name: 'Conselho de Segurança das Nações Unidas', countries: 9 },
  { code: 'ACNUR', name: 'Alto Comissariado das Nações Unidas para Refugiados', countries: 9 },
  { code: 'CDESC', name: 'Direitos econômicos, sociais e culturais da ONU', countries: 9 },
  { code: 'UNICEF', name: 'Fundo das Nações Unidas para a Infância', countries: 10 }
];
export const committeeByCode = code => COMMITTEES.find(c => c.code === code);

// Criteria from the original CodePen. The roster is intentionally preserved.
const originalRules = {
  CSNU: { veto: true, paisesVeto: ['EUA', 'RUSSIA', 'CHINA', 'FRANCA', 'REINO UNIDO'], maioria: '3/5' },
  CDH: { veto: false, paisesVeto: [], maioria: 'simples' },
  OMS: { veto: false, paisesVeto: [], maioria: '2/3' },
  UNESCO: { veto: false, paisesVeto: [], maioria: '2/3' },
  ONUM: { veto: false, paisesVeto: [], maioria: 'simples' },
  UNICEF: { veto: false, paisesVeto: [], maioria: 'simples' },
  CDESC: { veto: false, paisesVeto: [], maioria: 'simples' },
  ACNUR: { veto: false, paisesVeto: [], maioria: 'simples' }
};
const countryKey = country => country.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
export const VOTING_RULES = Object.freeze(Object.fromEntries(Object.entries(originalRules).map(([code, rule]) => {
  const vetoCountries = COUNTRIES.slice(0, committeeByCode(code).countries).filter(country => rule.paisesVeto.includes(countryKey(country)));
  return [code, Object.freeze({ ...rule, paisesVeto: Object.freeze(rule.paisesVeto), hasVeto: rule.veto, vetoCountries: Object.freeze(vetoCountries), majority: rule.maioria })];
})));

export function emptyForm(code) {
  const committee = committeeByCode(code);
  const rule = VOTING_RULES[code];
  return { committee: code, hasVeto: rule.hasVeto, crisisTitle: '', crisisDetails: '', proposalText: '', votingRound: 0, state: { vetoCountries: [...rule.vetoCountries], delegations: COUNTRIES.slice(0, committee.countries).map(country => ({ country, comment: '', vote: '' })) } };
}
