// Cron: re-fetch high-priority sources
// Schedule: 6am & 6pm (see vercel.json)

import type { APIRoute } from 'astro';
import { requireCronAuth } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase/server';
import { runSourceIngestion } from '@/services/ingestion/pipeline';
import { createLogger } from '@/lib/logger';
import type { Source } from '@/types/database';

const PRIORITY_THRESHOLD = 7;
const logger = createLogger('cron:refresh-priority-sources');

export const GET: APIRoute = async ({ request }) => {
  return handler(request);
};

export const POST: APIRoute = async ({ request }) => {
  return handler(request);
};

async function handler(request: Request): Promise<Response> {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  logger.info('Cron refresh-priority-sources started');

  const db = getAdminClient();
  const { data: sources, error } = await db
    .from('sources')
    .select('*')
    .eq('enabled', true)
    .gte('priority', PRIORITY_THRESHOLD)
    .order('priority', { ascending: false });

  if (error) {
    logger.error('Failed to fetch priority sources', { error: error.message });
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  logger.info('Priority sources to refresh', { count: (sources ?? []).length });

  const results = [];
  for (const source of (sources ?? []) as Source[]) {
    const result = await runSourceIngestion(source);
    results.push(result);
  }

  const summary = {
    sources: results.length,
    totalFound: results.reduce((s, r) => s + r.itemsFound, 0),
    totalInserted: results.reduce((s, r) => s + r.itemsInserted, 0),
    errors: results.flatMap(r => r.errors),
  };

  logger.info('Cron refresh-priority-sources complete', summary);

  return new Response(JSON.stringify({ ok: true, summary }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
