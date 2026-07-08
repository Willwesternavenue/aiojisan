// Quota-depletion alerts surfaced on the admin dashboard.

import { getAdminClient } from '@/lib/supabase/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('system-alerts');

const DEDUP_WINDOW_HOURS = 6;

/**
 * Record a quota/credit-depletion alert for the admin dashboard.
 * Deduplicates per source within a 6h window. Never throws — alerting
 * must not break the image-generation flow.
 */
export async function recordQuotaAlert(
  source: 'gemini' | 'openai',
  message: string,
): Promise<void> {
  try {
    const db = getAdminClient();
    const since = new Date(Date.now() - DEDUP_WINDOW_HOURS * 3600_000).toISOString();
    const { data: existing } = await db
      .from('system_alerts')
      .select('id')
      .eq('source', source)
      .gte('created_at', since)
      .limit(1)
      .maybeSingle();
    if (existing) return;

    await db.from('system_alerts').insert({ source, kind: 'quota', message });
    logger.warn('Quota alert recorded', { source });
  } catch (err) {
    logger.warn('Failed to record quota alert', { source, err: String(err) });
  }
}
