import { createBackend } from '../_shared/supabase-rest.mjs';
import { createChartBackend } from '../_shared/chart-rest.mjs';
import { createPriceHistoryService } from '../_shared/price-history.mjs';
import { createPriceHistoryHandler } from '../_shared/price-history-handler.mjs';
const url = Deno.env.get('SUPABASE_URL');
const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const backend = createBackend({ url, publicKey, serviceKey });
const chart = createChartBackend({ url, publicKey, serviceKey });
Deno.serve(createPriceHistoryHandler({
  getUser: backend.getUser,
  getHistory: createPriceHistoryService({ store: chart.priceStore, apiKey: Deno.env.get('ALPHA_VANTAGE_API_KEY') }),
  origins: (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean),
}));
