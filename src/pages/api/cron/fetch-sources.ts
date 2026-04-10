// Cron: fetch all enabled sources
// Schedule: every 15 minutes (see vercel.json)

import type { APIRoute } from 'astro';
import { requireCronAuth } from '@/lib/auth';
import { runAllEnabledSources } from '@/services/ingestion/pipeline';
import { createLogger } from '@/lib/logger';

const logger = createLogger('cron:fetch-sources');

export const POST: APIRoute = async ({ request }) => {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  logger.info('Cron fetch-sources started');

  try {
    const results = await runAllEnabledSources();

    const summary = {
      sources: results.length,
      totalFound: results.reduce((s, r) => s + r.itemsFound, 0),
      totalInserted: results.reduce((s, r) => s + r.itemsInserted, 0),
      errors: results.flatMap(r => r.errors),
    };

    logger.info('Cron fetch-sources complete', summary);

    return new Response(JSON.stringify({ ok: true, summary }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    logger.error('Cron fetch-sources failed', { err: String(err) });
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
