export const COUNTRIES = ['Brasil', 'Rússia', 'EUA', 'Índia', 'China', 'Nigéria', 'Alemanha', 'França', 'Turquia', 'Reino Unido'];
export const COMMITTEES = [
  { code: 'CDH', name: 'Comissão de Direitos Humanos', countries: 9 },
  { code: 'OMS', name: 'Organização Mundial da Saúde', countries: 9, majority: '2/3' },
  { code: 'UNESCO', name: 'Organização das Nações Unidas para Educação, Ciência e Cultura', countries: 9, majority: '2/3' },
  { code: 'ONUM', name: 'ONU Mulheres', countries: 9 },
  { code: 'CSNU', name: 'Conselho de Segurança das Nações Unidas', countries: 10, majority: '3/5', vetoCountries: ['EUA', 'Rússia', 'China', 'França', 'Reino Unido'] },
  { code: 'ACNUR', name: 'Alto Comissariado das Nações Unidas para Refugiados', countries: 9 },
  { code: 'CDESC', name: 'Direitos econômicos, sociais e culturais da ONU', countries: 9 },
  { code: 'UNICEF', name: 'Fundo das Nações Unidas para a Infância', countries: 10 }
];
export const committeeByCode = code => COMMITTEES.find(c => c.code === code);
export function emptyForm(code) {
  const committee = committeeByCode(code);
  return { committee: code, resetEpoch: '', hasVeto: Boolean(committee.vetoCountries), crisisTitle: '', crisisDetails: '', state: { vetoCountries: committee.vetoCountries || [], delegations: COUNTRIES.slice(0, committee.countries).map(country => ({ country, comment: '', vote: '' })), voting: { proposal: '', visualDecision: '', history: [] } } };
}

