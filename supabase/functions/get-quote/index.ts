import { createHandler } from '../_shared/handler.mjs';
import { createBackend } from '../_shared/supabase-rest.mjs';

const backend = createBackend({
  url: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
});

Deno.serve(createHandler({
  ...backend,
  apiKey: Deno.env.get('ALPHA_VANTAGE_API_KEY'),
  origins: (Deno.env.get('ALLOWED_ORIGINS') ?? '').split(',').map(s => s.trim()).filter(Boolean),
}));