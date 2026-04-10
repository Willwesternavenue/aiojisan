// Client-safe Supabase client (uses anon key)
// Safe to import in Astro components and client-side scripts

import { createClient } from '@supabase/supabase-js';

// These are exposed on the client — must be public/anon only
const supabaseUrl = import.meta.env.SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY as string;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
