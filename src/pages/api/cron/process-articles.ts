// Cron: AI-process newly ingested articles
// Schedule: every hour (see vercel.json)

import type { APIRoute } from 'astro';
import { requireCronAuth } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase/server';
import { getAiProvider } from '@/services/ai';
import { generateDraftForArticle } from '@/services/drafts/generate';
import { createLogger } from '@/lib/logger';

const AUTO_PUBLISH_THRESHOLD         = 8.5;
const EXCEPTIONAL_PUBLISH_THRESHOLD  = 9.2;
const DAILY_AUTO_PUBLISH_TARGET      = 5;

const logger = createLogger('cron:process-articles');
const BATCH_SIZE = 20;

export const GET: APIRoute = async ({ request }) => {
  return handler(request);
};

export const POST: APIRoute = async ({ request }) => {
  return handler(request);
};

function getJstDayStart(date = new Date()): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [year, month, day] = formatter.format(date).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, -9, 0, 0)).toISOString();
}

async function getPublishedCountToday(db: ReturnType<typeof getAdminClient>): Promise<number> {
  const { count, error } = await db
    .from('generated_drafts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'published')
    .gte('created_at', getJstDayStart());

  if (error) {
    logger.warn('Failed to count published drafts today', { error: error.message });
    return 0;
  }

  return count ?? 0;
}

async function handler(request: Request): Promise<Response> {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  logger.info('Cron process-articles started');

  const db = getAdminClient();
  const ai = getAiProvider();
  let publishedToday = await getPublishedCountToday(db);

  // LEFT JOINで未処理記事を取得（NOT IN方式はID数が多いとURL長制限に引っかかるため）
  const { data: candidates, error } = await db
    .from('articles')
    .select('id, title, canonical_url, extracted_text, published_at, sources(name), article_ai_insights(article_id)')
    .order('fetched_at', { ascending: false })
    .limit(BATCH_SIZE * 10); // 多めに取得してクライアント側でフィルタ

  if (error) {
    logger.error('Failed to fetch article candidates', { error: error.message });
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // insightsがない記事だけ抽出してバッチサイズに絞る
  const articles = (candidates ?? [])
    .filter((a: any) => {
      const ins = a.article_ai_insights;
      return !ins || (Array.isArray(ins) && ins.length === 0) || ins === null;
    })
    .slice(0, BATCH_SIZE);

  let processed = 0;
  let failed = 0;

  for (const article of articles) {
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

        const shouldAutoPublish =
          scores.overallScore >= EXCEPTIONAL_PUBLISH_THRESHOLD ||
          (
            scores.overallScore >= AUTO_PUBLISH_THRESHOLD &&
            publishedToday < DAILY_AUTO_PUBLISH_TARGET
          );

        if (shouldAutoPublish) {
          logger.info('Score threshold met, auto-publishing', {
            articleId: article.id,
            score: scores.overallScore,
            publishedToday,
          });
          try {
            await generateDraftForArticle(article.id, { autoPublish: true });
            publishedToday++;
          } catch (draftErr) {
            logger.warn('Auto-publish failed', { articleId: article.id, err: String(draftErr) });
          }
        } else if (scores.overallScore >= AUTO_PUBLISH_THRESHOLD) {
          logger.info('Auto-publish skipped by daily target', {
            articleId: article.id,
            score: scores.overallScore,
            publishedToday,
            dailyTarget: DAILY_AUTO_PUBLISH_TARGET,
          });
        }
      }

      // Rate limit buffer
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      logger.error('Article processing failed', { articleId: article.id, err: String(err) });
      failed++;
    }
  }

  const result = { ok: true, processed, failed, total: (articles ?? []).length, publishedToday };
  logger.info('Cron process-articles complete', result);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
