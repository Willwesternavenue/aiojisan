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

/**
 * Record that a WordPress post went live but could not be written to the
 * database. Such a post is unguarded: the next run sees no draft on record
 * and can publish the same article again. Not deduplicated — every
 * occurrence names a distinct orphaned post that needs manual cleanup.
 * Never throws; the post is already live and alerting must not mask that.
 */
export async function recordUnrecordedPostAlert(
  articleId: string,
  wpPostId: number,
  detail: string,
): Promise<void> {
  try {
    const db = getAdminClient();
    await db.from('system_alerts').insert({
      source: 'wordpress',
      kind: 'unrecorded_post',
      message: `WordPress post ${wpPostId} is live but was not recorded (article ${articleId}): ${detail}`.slice(0, 500),
    });
    logger.error('Unrecorded live post alert recorded', { articleId, wpPostId });
  } catch (err) {
    logger.warn('Failed to record unrecorded-post alert', { articleId, wpPostId, err: String(err) });
  }
}
