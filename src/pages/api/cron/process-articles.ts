// Cron: AI-process newly ingested articles
// Schedule: every hour (see vercel.json)

import type { APIRoute } from 'astro';
import { requireCronAuth } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase/server';
import { getAiProvider } from '@/services/ai';
import { generateDraftForArticle } from '@/services/drafts/generate';
import { createLogger } from '@/lib/logger';
import type { Article } from '@/types/database';

const AUTO_DRAFT_THRESHOLD = 7.9;

const logger = createLogger('cron:process-articles');
const BATCH_SIZE = 20;

export const POST: APIRoute = async ({ request }) => {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  logger.info('Cron process-articles started');

  const db = getAdminClient();
  const ai = getAiProvider();

  // Fetch IDs that already have insights
  const { data: insightRows } = await db
    .from('article_ai_insights')
    .select('article_id');
  const processedIds = (insightRows ?? []).map((r: { article_id: string }) => r.article_id);

  // Fetch articles that have no AI insights yet
  let articlesQuery = db
    .from('articles')
    .select('id, title, canonical_url, extracted_text, published_at, sources(name)')
    .order('fetched_at', { ascending: false })
    .limit(BATCH_SIZE);

  if (processedIds.length > 0) {
    articlesQuery = articlesQuery.not('id', 'in', `(${processedIds.join(',')})`);
  }

  const { data: articles, error } = await articlesQuery;

  if (error) {
    logger.error('Failed to fetch unprocessed articles', { error: error.message });
    return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  }

  let processed = 0;
  let failed = 0;

  for (const article of (articles ?? [])) {
    try {
      const sourceName = (article.sources as unknown as { name: string } | null)?.name ?? 'Unknown';

      // 1. Summarize
      const summary = await ai.summarizeArticle({
        title: article.title,
        url: article.canonical_url,
        extractedText: article.extracted_text ?? '',
        publishedAt: article.published_at,
        sourceName,
      });

      // 2. Score
      const scores = await ai.scoreArticle({
        title: article.title,
        url: article.canonical_url,
        extractedText: article.extracted_text ?? '',
        publishedAt: article.published_at,
        sourceName,
        summary: summary.shortSummary,
      });

      // 3. Store
      const { error: insertError } = await db.from('article_ai_insights').insert({
        article_id: article.id,
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

      if (insertError) {
        logger.warn('Insights insert failed', { articleId: article.id, error: insertError.message });
        failed++;
      } else {
        processed++;

        // Auto-draft if score >= threshold
        if (scores.overallScore >= AUTO_DRAFT_THRESHOLD) {
          logger.info('Score threshold met, auto-drafting', {
            articleId: article.id,
            score: scores.overallScore,
          });
          try {
            await generateDraftForArticle(article.id);
          } catch (draftErr) {
            logger.warn('Auto-draft failed', { articleId: article.id, err: String(draftErr) });
          }
        }
      }

      // Rate limit buffer
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      logger.error('Article processing failed', { articleId: article.id, err: String(err) });
      failed++;
    }
  }

  const result = { ok: true, processed, failed, total: (articles ?? []).length };
  logger.info('Cron process-articles complete', result);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
