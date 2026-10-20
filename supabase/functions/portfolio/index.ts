import { createBackend } from '../_shared/supabase-rest.mjs';
import { createQuoteService } from '../_shared/quote-service.mjs';
import { createPortfolioReader } from '../_shared/portfolio-rest.mjs';
import { createPortfolioHandler } from '../_shared/portfolio-handler.mjs';

const url = Deno.env.get('SUPABASE_URL');
const publicKey = Deno.env.get('SUPABASE_ANON_KEY');
const backend = createBackend({ url, publicKey, serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') });
Deno.serve(createPortfolioHandler({
  getUser: backend.getUser,
  readPortfolio: createPortfolioReader({ url, publicKey }),
  getQuote: createQuoteService({ store: backend.store, apiKey: Deno.env.get('ALPHA_VANTAGE_API_KEY') }),
  origins: (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean),
}));
