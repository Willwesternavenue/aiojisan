// API: Score unscored articles for a specific day (gap-backfill helper).
// The scoring cron was down 6/22–7/01, so those articles have no
// article_ai_insights and cannot be backdate-published. This re-runs the
// standard summarize+score pipeline over one day's candidates, in bounded
// batches so a single request stays under the function time limit.
// Protected by CRON_SECRET because it writes insights and costs AI calls.

import type { APIRoute } from 'astro';
import { requireCronAuth } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase/server';
import { getAiProvider } from '@/services/ai';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:score-day');
const MAX_PER_SOURCE = 3;
const HARD_LIMIT = 20; // keep one request comfortably under the 300s ceiling

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  let day = '';
  let limit = 15;
  try {
    const body = (await request.json()) as { day?: string; limit?: number };
    day = body.day ?? '';
    limit = Math.min(Math.max(1, body.limit ?? 15), HARD_LIMIT);
  } catch {
    /* ignore */
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return json({ ok: false, error: 'day must be YYYY-MM-DD' }, 400);
  }

  const lo = `${day}T00:00:00Z`;
  const hi = new Date(new Date(lo).getTime() + 86_400_000).toISOString();

  const db = getAdminClient();
  const ai = getAiProvider();

  const { data, error } = await db
    .from('articles')
    .select(
      'id, source_id, title, canonical_url, extracted_text, published_at, fetched_at, sources(name, priority), article_ai_insights(article_id)',
    )
    .gte('fetched_at', lo)
    .lt('fetched_at', hi)
    .limit(1000);

  if (error) return json({ ok: false, error: error.message }, 500);

  const unscored = (data ?? []).filter((a: any) => {
    const ins = a.article_ai_insights;
    return !ins || (Array.isArray(ins) && ins.length === 0);
  });

  // Round-robin by source priority, capped per source, to pick a fair pool.
  const bySource = new Map<string, any[]>();
  for (const a of unscored) {
    const sid = a.source_id ?? 'unknown';
    const bucket = bySource.get(sid) ?? [];
    if (bucket.length < MAX_PER_SOURCE) bucket.push(a);
    bySource.set(sid, bucket);
  }
  const buckets = [...bySource.values()].sort(
    (a, b) =>
      Number((b[0].sources as { priority?: number } | null)?.priority ?? 0) -
      Number((a[0].sources as { priority?: number } | null)?.priority ?? 0),
  );
  const picked: any[] = [];
  for (let i = 0; picked.length < limit; i++) {
    let added = false;
    for (const bucket of buckets) {
      if (bucket[i]) {
        picked.push(bucket[i]);
        added = true;
        if (picked.length >= limit) break;
      }
    }
    if (!added) break;
  }

  let scored = 0;
  let failed = 0;
  for (const a of picked) {
    try {
      const sourceName = (a.sources as { name?: string } | null)?.name ?? 'Unknown';
      const input = {
        title: a.title,
        url: a.canonical_url,
        extractedText: a.extracted_text ?? '',
        publishedAt: a.published_at,
        sourceName,
      };
      const summary = await ai.summarizeArticle(input);
      const scores = await ai.scoreArticle({ ...input, summary: summary.shortSummary });
      const { error: insErr } = await db.from('article_ai_insights').insert({
        article_id: a.id,
        short_summary: summary.shortSummary,
        long_summary: summary.longSummary,
        tags: summary.tags,
        topics: summary.topics,
        ai_ojisan_fit_score: scores.aiOjisanFitScore,
        x_post_potential_score: scores.xPostPotentialScore,
        blog_post_potential_score: scores.blogPostPotentialScore,
        novelty_score: scores.noveltyScore,
        source_reliability_score: scores.sourceReliabilityScore,
        overall_score: scores.overallScore,
        reasoning: scores.reasoning,
      });
      if (insErr) {
        failed++;
        logger.warn('Insights insert failed', { articleId: a.id, error: insErr.message });
      } else {
        scored++;
      }
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      failed++;
      logger.warn('Scoring failed', { articleId: a.id, err: String(err) });
    }
  }

  return json({ ok: true, day, candidates: unscored.length, scored, failed, remaining: unscored.length - scored });
};
