// Server-only Supabase admin client (uses service role key)
// NEVER import this in client-side code or Astro component frontmatter
// that runs on the client. Only use in API routes and server-side services.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseServiceKey } from '@/lib/env';

// Using `any` as schema type until Supabase types are generated via `supabase gen types`.
// TODO: run `supabase gen types typescript --linked > src/types/supabase.generated.ts`
//       and replace `any` with the generated Database type.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = SupabaseClient<any>;

let _adminClient: AdminClient | null = null;
let _adminClientUrl: string | null = null;

export function getAdminClient(): AdminClient {
  const url = (import.meta.env.SUPABASE_URL as string | undefined) ?? 'http://localhost:54321';
  const key = (import.meta.env.SUPABASE_SERVICE_ROLE_KEY as string | undefined) ?? 'dev-placeholder';

  // Re-create if URL changed (e.g. env loaded after first call in dev)
  if (_adminClient && _adminClientUrl === url) return _adminClient;

  _adminClient = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  _adminClientUrl = url;
  return _adminClient;
}
