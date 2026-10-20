export function validatePortfolio(data) {
  const money = value => typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value);
  if (!data || data.currency !== 'USD' || !money(data.cash_balance) || !Array.isArray(data.positions) ||
      typeof data.valuation_complete !== 'boolean' || (data.valuation_complete && !money(data.total_portfolio_value))) {
    throw new Error('Netinkamas portfelio atsakymas.');
  }
  return data;
}
export async function loadPortfolio(client) {
  const { data, error } = await client.auth.getSession();
  if (error || !data.session) throw new Error('Prisijunkite, kad matytumėte savo portfelį.');
  const result = await client.functions.invoke('portfolio', { method: 'GET', headers: { Authorization: 'Bearer ' + data.session.access_token } });
  if (result.error) throw new Error(result.error.context?.status === 401 ? 'Sesija pasibaigė. Prisijunkite iš naujo.' : 'Portfelio gauti nepavyko. Bandykite dar kartą vėliau.');
  return validatePortfolio(result.data);
}
