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
export function emptyForm(code) {
  const committee = committeeByCode(code);
  return { committee: code, hasVeto: false, crisisTitle: '', crisisDetails: '', state: { vetoCountries: [], delegations: COUNTRIES.slice(0, committee.countries).map(country => ({ country, comment: '', vote: '' })) } };
}
