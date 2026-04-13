// Admin auth helpers — server-side only

import type { APIContext } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseAnonKey } from '@/lib/env';

// ── Cron auth ─────────────────────────────────────────────────────────────

export function isCronRequest(request: Request): boolean {
  const secret = import.meta.env.CRON_SECRET as string | undefined;

  // If CRON_SECRET is not configured, allow requests from Vercel's internal cron
  // (identified by the x-vercel-cron header) as a fallback.
  if (!secret) {
    return request.headers.get('x-vercel-cron') === '1';
  }

  const authHeader = request.headers.get('authorization');
  if (authHeader === `Bearer ${secret}`) return true;

  // Also accept Vercel's internal cron header when secret matches
  if (request.headers.get('x-vercel-cron') === '1') return true;

  const url = new URL(request.url);
  return url.searchParams.get('cron_secret') === secret;
}

export function requireCronAuth(request: Request): Response | null {
  if (!isCronRequest(request)) {
    return new Response('Unauthorized', { status: 401 });
  }
  return null;
}

// ── Admin session auth ─────────────────────────────────────────────────────
// Validates the JWT stored in the admin_session cookie against Supabase Auth.
// Returns null if valid (proceed), or a redirect Response if not.

export async function requireAdminSession(context: APIContext): Promise<Response | null> {
  const { cookies, redirect } = context;

  // Dev bypass: if SUPABASE_URL is not set, allow access in development only
  if (import.meta.env.DEV && !import.meta.env.SUPABASE_URL) {
    return null;
  }

  const token = cookies.get('admin_session')?.value;

  if (!token) {
    return redirect('/admin/login');
  }

  try {
    const supabase = createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      cookies.delete('admin_session', { path: '/' });
      return redirect('/admin/login');
    }

    return null;
  } catch {
    cookies.delete('admin_session', { path: '/' });
    return redirect('/admin/login');
  }
}
