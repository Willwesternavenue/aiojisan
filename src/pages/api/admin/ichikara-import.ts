// API: import ichikarablog posts into the style corpus (resumable).
// Protected by CRON_SECRET because it spends embedding credits.

import type { APIRoute } from 'astro';
import { requireCronAuth } from '@/lib/auth';
import { importIchikaraPosts } from '@/services/rag/ichikara-import';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:ichikara-import');

export const POST: APIRoute = async ({ request }) => {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  let limit = 1;
  let startPage = 1;
  try {
    const body = (await request.json()) as { limit?: number; start_page?: number };
    if (typeof body.limit === 'number') limit = Math.min(Math.max(1, body.limit), 5);
    if (typeof body.start_page === 'number') startPage = Math.max(1, body.start_page);
  } catch {
    // defaults are fine
  }

  try {
    const result = await importIchikaraPosts({ limit, startPage });
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    logger.error('ichikarablog import failed', { err: String(err) });
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
