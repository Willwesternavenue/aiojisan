// API: Backdate-publish a single past article (one-off backfill).
// Protected by CRON_SECRET because it publishes live content.

import type { APIRoute } from 'astro';
import { requireCronAuth } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase/server';
import { generateDraftForArticle } from '@/services/drafts/generate';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:backfill-article');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  let articleId: string | null = null;
  let publishDateOverride: string | null = null;
  try {
    const body = (await request.json()) as { article_id?: string; publish_date?: string };
    articleId = body.article_id ?? null;
    publishDateOverride = body.publish_date ?? null;
  } catch {
    articleId = null;
  }

  if (!articleId) return json({ ok: false, error: 'Missing article_id' }, 400);

  const db = getAdminClient();
  const { data: article, error } = await db
    .from('articles')
    .select('published_at, fetched_at')
    .eq('id', articleId)
    .single();

  if (error || !article) return json({ ok: false, error: 'Article not found' }, 404);

  // Optional override lets us spread seed articles across distinct dates instead
  // of clumping them all on the source's own publish date.
  const publishDate = (publishDateOverride ?? article.published_at ?? article.fetched_at) as string;
  logger.info('Backfilling article', { articleId, publishDate });

  try {
    const result = await generateDraftForArticle(articleId, {
      autoPublish: true,
      publishDate,
      skipSocial: true,
    });
    return json({ ok: true, wpPostId: result?.wpPostId ?? null, skipped: result === null });
  } catch (err) {
    logger.error('Backfill failed', { articleId, err: String(err) });
    return json({ ok: false, error: String(err) }, 500);
  }
};
