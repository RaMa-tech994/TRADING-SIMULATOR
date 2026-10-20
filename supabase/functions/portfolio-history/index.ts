import { createBackend } from '../_shared/supabase-rest.mjs';
import { createChartBackend } from '../_shared/chart-rest.mjs';
import { createPortfolioReader } from '../_shared/portfolio-rest.mjs';
import { createQuoteService } from '../_shared/quote-service.mjs';
import { createPortfolioHistoryHandler } from '../_shared/portfolio-history-handler.mjs';
const url = Deno.env.get('SUPABASE_URL');
const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
const backend = createBackend({ url, publicKey, serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') });
const chart = createChartBackend({ url, publicKey });
Deno.serve(createPortfolioHistoryHandler({
  getUser: backend.getUser, list: chart.list, capture: chart.capture,
  readPortfolio: createPortfolioReader({ url, publicKey }),
  getQuote: createQuoteService({ store: backend.store, apiKey: Deno.env.get('ALPHA_VANTAGE_API_KEY') }),
  origins: [Deno.env.get('ALLOWED_ORIGINS'), Deno.env.get('HISTORY_ALLOWED_ORIGINS')].filter(Boolean).join(',').split(',').map(s => s.trim()).filter(Boolean),
}));
