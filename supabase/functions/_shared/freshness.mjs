// Planinės JAV akcijų rinkos nedarbo ir sutrumpintos dienos, 2026–2028 m.
// Šaltinis: https://ir.theice.com/press/news-details/2025/NYSE-Group-Announces-2026-2027-and-2028-Holiday-and-Early-Closings-Calendar/default.aspx
// Neapima neplanuotų uždarymų. Už šio laikotarpio ribų šviežumas nepatvirtinamas.
const HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24',
  '2028-01-17', '2028-02-21', '2028-04-14', '2028-05-29', '2028-06-19',
  '2028-07-04', '2028-09-04', '2028-11-23', '2028-12-25',
]);
const EARLY_CLOSES = new Set([
  '2026-11-27', '2026-12-24', '2027-11-26', '2028-07-03', '2028-11-24',
]);
const marketClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const DAY_MS = 86400000;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
// Projekto atsargumo taisyklė, ne tiekėjo pažadėtas paskelbimo terminas.
const PUBLICATION_GRACE_MINUTES = 120;

function covered(date) {
  return date >= '2026-01-01' && date <= '2028-12-31';
}
function tradingDay(date) {
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  return weekday !== 0 && weekday !== 6 && !HOLIDAYS.has(date);
}

export function expectedTradingDate(now) {
  const parts = Object.fromEntries(marketClock.formatToParts(now).map(p => [p.type, p.value]));
  const today = parts.year + '-' + parts.month + '-' + parts.day;
  if (!covered(today)) return null;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const close = (EARLY_CLOSES.has(today) ? 13 : 16) * 60;
  if (tradingDay(today) && minutes >= close + PUBLICATION_GRACE_MINUTES) return today;
  let candidate = new Date(today + 'T00:00:00Z').getTime();
  // Prieš uždarymą ir paskelbimo rezervą tikimasi ankstesnės sesijos kainos.
  for (let offset = 1; offset <= 10; offset++) {
    candidate -= DAY_MS;
    const date = new Date(candidate).toISOString().slice(0, 10);
    if (!covered(date)) return null;
    if (tradingDay(date)) return date;
  }
  return null;
}

export function describeQuote(quote, {
  fetchedAt, cached, fallback = false, now = new Date(), warning,
}) {
  const fetchedMs = typeof fetchedAt === 'string' ? Date.parse(fetchedAt) : NaN;
  const cacheAge = now.getTime() - fetchedMs;
  const cacheFresh = Number.isFinite(cacheAge) && cacheAge >= 0 && cacheAge < CACHE_TTL_MS;
  const expected = expectedTradingDate(now);
  const parts = Object.fromEntries(marketClock.formatToParts(now).map(p => [p.type, p.value]));
  const marketToday = parts.year + '-' + parts.month + '-' + parts.day;
  let priceFreshness = 'unverified';
  if (expected && covered(quote.trading_date) && tradingDay(quote.trading_date)
      && quote.trading_date <= marketToday) {
    priceFreshness = quote.trading_date < expected ? 'outdated_daily' : 'recent_daily';
  }
  const possiblyStale = priceFreshness !== 'recent_daily' || fallback;
  const messages = ['Tai dienos kaina pagal trading_date, ne realaus laiko kotiruotė.'];
  if (priceFreshness === 'outdated_daily') messages.push('Kainos prekybos data senesnė už numatomą paskutinę sesiją.');
  if (priceFreshness === 'unverified') messages.push('Kainos aktualumo pagal turimą biržos kalendorių patvirtinti negalima.');
  if (!cacheFresh) messages.push('Talpyklos techninis galiojimas pasibaigęs arba nepatvirtintas.');
  if (warning) messages.push(warning);
  return {
    ...quote,
    fetched_at: fetchedAt,
    cached,
    cache_fresh: cacheFresh,
    price_freshness: priceFreshness,
    expected_trading_date: expected,
    possibly_stale: possiblyStale,
    // Suderinamumo laukas: įspėja apie kainos arba talpyklos neaktualumą.
    stale: possiblyStale || !cacheFresh,
    is_realtime: false,
    warning: messages.join(' '),
  };
}