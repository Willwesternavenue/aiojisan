// GET /api/status — operational digest for external routines.
// Auth: STATUS_TOKEN or CRON_SECRET, as a bearer header or a query parameter.
// If the caller's fetch tool drops query strings, use /api/status/<token>.

import type { APIRoute } from 'astro';
import { requireStatusAuth } from '@/lib/auth';
import { buildStatusDigest } from '@/services/status';

export const GET: APIRoute = async ({ request }) => {
  const authError = requireStatusAuth(request);
  if (authError) return authError;
  return buildStatusDigest();
};
