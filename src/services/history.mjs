export const SYMBOLS = ['AAPL', 'MSFT', 'AMZN', 'GOOGL', 'META', 'NVDA', 'TSLA', 'IBM', 'NFLX', 'AMD'];

export function parseHistory(data, kind, symbol) {
  if (!data || data.currency !== 'USD' || !Array.isArray(data.points) ||
      (kind === 'price' && data.symbol !== symbol)) throw new Error('Netinkamas istorijos atsakymas.');
  const fields = kind === 'price' ? ['close'] : ['portfolio_value', 'total_profit_loss'];
  const timeKey = kind === 'price' ? 'date' : 'captured_at';
  let previous = -Infinity;
  for (const point of data.points) {
    const time = Date.parse(point[timeKey]);
    if (!Number.isFinite(time) || time <= previous || fields.some(key =>
      typeof point[key] !== 'string' || !/^-?\d+(\.\d+)?$/.test(point[key]) || !Number.isFinite(Number(point[key]))) ||
      Number(point[fields[0]]) < 0) throw new Error('Netinkamas istorijos atsakymas.');
    previous = time;
  }
  return data;
}

export async function loadHistory(client, kind, symbol) {
  const { data: sessionData, error: sessionError } = await client.auth.getSession();
  if (sessionError || !sessionData.session) throw new Error('Prisijunkite, kad matytumėte istoriją.');
  const endpoint = kind === 'price' ? `price-history?symbol=${encodeURIComponent(symbol)}` : 'portfolio-history?limit=100';
  const { data, error } = await client.functions.invoke(endpoint, {
    method: 'GET', headers: { Authorization: `Bearer ${sessionData.session.access_token}` },
  });
  if (error) {
    const status = error.context?.status;
    throw new Error(status === 401 ? 'Sesija pasibaigė. Prisijunkite iš naujo.' : status === 429
      ? 'Pasiektas užklausų limitas. Bandykite vėliau.' : 'Istorijos gauti nepavyko. Bandykite dar kartą vėliau.');
  }
  return parseHistory(data, kind, symbol);
}

// Skaičiai naudojami tik SVG koordinatėms; finansinės sumos neskaičiuojamos.
export function chartGeometry(points, timeKey, valueKey, includeZero = false) {
  const values = points.map(point => Number(point[valueKey]));
  let min = Math.min(...values, ...(includeZero ? [0] : []));
  let max = Math.max(...values, ...(includeZero ? [0] : []));
  if (min === max) { min -= 1; max += 1; }
  const first = Date.parse(points[0][timeKey]);
  const span = Date.parse(points.at(-1)[timeKey]) - first;
  const y = value => 210 - (value - min) / (max - min) * 180;
  return { min, max, zeroY: y(0), coordinates: points.map(point => ({
    x: span ? 80 + (Date.parse(point[timeKey]) - first) / span * 590 : 375,
    y: y(Number(point[valueKey])),
  })) };
}
