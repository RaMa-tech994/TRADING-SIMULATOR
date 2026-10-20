import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;
let configured = false;
try {
  configured = new URL(supabaseUrl).protocol === 'https:' && Boolean(supabaseKey);
} catch { /* Istorijos puslapis parodo konfigūracijos klaidą. */ }
export const supabase = configured ? createClient(supabaseUrl, supabaseKey) : null;
