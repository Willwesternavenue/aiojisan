// System alerts surfaced on the admin dashboard.
//
// Several steps in the pipeline swallow their failures on purpose: a provider
// hiccup must not stop an article from being published, and one dead source
// must not abort a whole ingestion run. That design only holds if the swallowed
// failure is visible somewhere — three posts once sat with placeholder images
// for two weeks, and a blocked source went unnoticed for days, because the
// failure was only ever a log line. Everything swallowed on a path that can
// leave published output degraded records an alert here.

import { getAdminClient } from '@/lib/supabase/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('system-alerts');

export type AlertKind =
  | 'quota'            // AI provider credits exhausted
  | 'unrecorded_post'  // WordPress post is live but has no database row
  | 'image_failed'     // featured image generation failed; post is live without one
  | 'category_failed'  // category assignment failed; post is live uncategorised
  | 'social_failed'    // X post failed; article published but never shared
  | 'source_failed'    // a whole source failed to ingest
  | 'research_failed'; // web research failed; draft written without live sources

/**
 * Core alert writer. Never throws — alerting must not mask the failure it
 * describes, nor break a path that deliberately continues after an error.
 *
 * Deduplication matches existing alerts of the same kind, either on the
 * `source` column (`dedupeBySource`) or on a substring of the message
 * (`dedupeKey`). Without `dedupeWindowHours` it dedupes forever — right for
 * per-post alerts, where one post warrants one alert. With it, only within
 * that window — right for a recurring condition like a dead source polled
 * every 15 minutes. Pass neither to record every occurrence.
 */
async function recordAlert(opts: {
  source: string;
  kind: AlertKind;
  message: string;
  dedupeKey?: string;
  dedupeBySource?: boolean;
  dedupeWindowHours?: number;
}): Promise<void> {
  const { source, kind, message, dedupeKey, dedupeBySource, dedupeWindowHours } = opts;
  try {
    const db = getAdminClient();

    if (dedupeKey || dedupeBySource) {
      let query = db
        .from('system_alerts')
        .select('id')
        .eq('kind', kind);

      if (dedupeBySource) query = query.eq('source', source);
      if (dedupeKey) query = query.ilike('message', `%${dedupeKey}%`);

      if (dedupeWindowHours !== undefined) {
        query = query.gte(
          'created_at',
          new Date(Date.now() - dedupeWindowHours * 3600_000).toISOString(),
        );
      }

      const { data: existing } = await query.limit(1).maybeSingle();
      if (existing) return;
    }

    await db.from('system_alerts').insert({
      source,
      kind,
      message: message.slice(0, 500),
    });
    logger.error('Alert recorded', { kind, source });
  } catch (err) {
    logger.warn('Failed to record alert', { kind, source, err: String(err) });
  }
}

/** AI provider credits are exhausted. Deduplicated per provider, 6h window. */
export async function recordQuotaAlert(
  source: 'gemini' | 'openai',
  message: string,
): Promise<void> {
  await recordAlert({
    source,
    kind: 'quota',
    message,
    dedupeBySource: true,
    dedupeWindowHours: 6,
  });
}

/**
 * A WordPress post went live but could not be written to the database. Such a
 * post is unguarded: the next run sees no draft on record and can publish the
 * same article again. Not deduplicated — each names a distinct orphaned post.
 */
export async function recordUnrecordedPostAlert(
  articleId: string,
  wpPostId: number,
  detail: string,
): Promise<void> {
  await recordAlert({
    source: 'wordpress',
    kind: 'unrecorded_post',
    message: `post ${wpPostId}: live but not recorded (article ${articleId}) — ${detail}`,
  });
}

/** Featured image generation failed; the post is live without one. */
export async function recordImageFailureAlert(
  wpPostId: number,
  slug: string,
  detail: string,
): Promise<void> {
  await recordAlert({
    source: 'image',
    kind: 'image_failed',
    message: `post ${wpPostId}: featured image failed for "${slug}" — ${detail}`,
    dedupeKey: `post ${wpPostId}:`,
  });
}

/**
 * Category assignment failed; the post is live but uncategorised, so it never
 * appears in its pillar listing on the public site.
 */
export async function recordCategoryFailureAlert(
  wpPostId: number,
  categorySlug: string,
  detail: string,
): Promise<void> {
  await recordAlert({
    source: 'wordpress',
    kind: 'category_failed',
    message: `post ${wpPostId}: category "${categorySlug}" not applied — ${detail}`,
    dedupeKey: `post ${wpPostId}: category "${categorySlug}"`,
  });
}

/** The article published but was never posted to X. */
export async function recordSocialFailureAlert(
  wpPostId: number,
  detail: string,
): Promise<void> {
  await recordAlert({
    source: 'x',
    kind: 'social_failed',
    message: `post ${wpPostId}: X post failed — ${detail}`,
    dedupeKey: `post ${wpPostId}: X post`,
  });
}

/**
 * A whole source failed to ingest. Deduplicated per source on a 6h window:
 * fetch-sources runs every 15 minutes, so a persistently dead source would
 * otherwise write ~96 rows a day.
 */
export async function recordSourceFailureAlert(
  sourceName: string,
  detail: string,
): Promise<void> {
  await recordAlert({
    source: 'ingestion',
    kind: 'source_failed',
    message: `source "${sourceName}": ingestion failed — ${detail}`,
    dedupeKey: `source "${sourceName}":`,
    dedupeWindowHours: 6,
  });
}

/** Web research failed; the draft was written without live sources. */
export async function recordResearchFailureAlert(
  topic: string,
  detail: string,
): Promise<void> {
  await recordAlert({
    source: 'research',
    kind: 'research_failed',
    message: `research failed for "${topic.slice(0, 60)}" — ${detail}`,
    dedupeWindowHours: 6,
    dedupeKey: 'research failed',
  });
}
