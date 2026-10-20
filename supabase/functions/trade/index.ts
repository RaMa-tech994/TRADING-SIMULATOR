import { createBackend } from '../_shared/supabase-rest.mjs';
import { createQuoteService } from '../_shared/quote-service.mjs';
import { createTradeExecutor } from '../_shared/trade-rest.mjs';
import { createTradeHandler } from '../_shared/trade-handler.mjs';

const url = Deno.env.get('SUPABASE_URL');
const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
const backend = createBackend({
  url, publicKey, serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
});

Deno.serve(createTradeHandler({
  getUser: backend.getUser,
  executeTrade: createTradeExecutor({ url, publicKey }),
  getQuote: createQuoteService({
    store: backend.store, apiKey: Deno.env.get('ALPHA_VANTAGE_API_KEY'),
  }),
  origins: [Deno.env.get('ALLOWED_ORIGINS'), Deno.env.get('TRADE_ALLOWED_ORIGINS')].filter(Boolean).join(',').split(',').map(s => s.trim()).filter(Boolean),
}));