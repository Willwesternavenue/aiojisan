// Cron: AI-process newly ingested articles
// Schedule: every hour (see vercel.json)

import type { APIRoute } from 'astro';
import { requireCronAuth } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase/server';
import { getAiProvider } from '@/services/ai';
import { generateDraftForArticle } from '@/services/drafts/generate';
import { detectPillarCategories, includesPhysicalAi, type PillarSlug } from '@/services/editorial/pillars';
import { createLogger } from '@/lib/logger';

const AUTO_PUBLISH_THRESHOLD         = 8.5;
const EXCEPTIONAL_PUBLISH_THRESHOLD  = 9.2;
const DAILY_AUTO_PUBLISH_TARGET      = 5;
const DAILY_PHYSICAL_AI_TARGET       = 2;
const CARRYOVER_LOOKBACK_HOURS       = 48;
const CARRYOVER_CANDIDATE_LIMIT      = 50;
const FLOOR_PUBLISH_THRESHOLD        = 8.0;
const FLOOR_DROUGHT_HOURS            = 24;

const logger = createLogger('cron:process-articles');
const BATCH_SIZE = 20;
const MAX_ARTICLES_PER_SOURCE_PER_BATCH = 3;

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

type PublishStats = {
  total: number;
  byPillar: Record<PillarSlug, number>;
};

type EditorialScores = {
  overallScore: number;
  blogPostPotentialScore?: number | null;
};

type PublishDecision = {
  shouldAutoPublish: boolean;
  isExceptional: boolean;
  physicalAiLimitReached: boolean;
};

async function getPublishStatsToday(db: ReturnType<typeof getAdminClient>): Promise<PublishStats> {
  const stats: PublishStats = {
    total: 0,
    byPillar: {
      'physical-ai': 0,
      'ai-driven-development': 0,
      'overseas-ai-business': 0,
      'generative-ai-news': 0,
    },
  };

  const { data, error } = await db
    .from('generated_drafts')
    .select('generation_metadata')
    .eq('status', 'published')
    .gte('created_at', getJstDayStart());

  if (error) {
    logger.warn('Failed to fetch published draft stats today', { error: error.message });
    return stats;
  }

  stats.total = data?.length ?? 0;

  for (const row of data ?? []) {
    const metadata = row.generation_metadata as { pillarCategories?: string[] } | null;
    for (const pillar of metadata?.pillarCategories ?? []) {
      if (pillar in stats.byPillar) {
        stats.byPillar[pillar as PillarSlug]++;
      }
    }
  }

  return stats;
}

function getCarryoverCutoff(date = new Date()): string {
  return new Date(date.getTime() - CARRYOVER_LOOKBACK_HOURS * 60 * 60 * 1000).toISOString();
}

function getPillarCategories(fields: Array<string | null | undefined>) {
  return detectPillarCategories(fields);
}

function getPublishDecision(
  scores: EditorialScores,
  pillarCategories: ReturnType<typeof detectPillarCategories>,
  publishStats: PublishStats,
): PublishDecision {
  const isPhysicalAi = includesPhysicalAi(pillarCategories);
  const isExceptional = scores.overallScore >= EXCEPTIONAL_PUBLISH_THRESHOLD;
  const physicalAiLimitReached =
    isPhysicalAi && publishStats.byPillar['physical-ai'] >= DAILY_PHYSICAL_AI_TARGET;

  return {
    isExceptional,
    physicalAiLimitReached,
    shouldAutoPublish:
      !physicalAiLimitReached &&
      (
        isExceptional ||
        (
          scores.overallScore >= AUTO_PUBLISH_THRESHOLD &&
          publishStats.total < DAILY_AUTO_PUBLISH_TARGET
        )
      ),
  };
}

function incrementPublishStats(
  publishStats: PublishStats,
  pillarCategories: ReturnType<typeof detectPillarCategories>,
): void {
  publishStats.total++;
  for (const category of pillarCategories) {
    publishStats.byPillar[category.slug]++;
  }
}

async function publishArticle(
  articleId: string,
  scores: EditorialScores,
  pillarCategories: ReturnType<typeof detectPillarCategories>,
  publishStats: PublishStats,
  context: 'carryover' | 'new' | 'daily-floor',
): Promise<boolean> {
  const result = await generateDraftForArticle(articleId, { autoPublish: true });
  if (!result) {
    logger.info('Auto-publish skipped because draft already exists', { articleId, context });
    return false;
  }

  incrementPublishStats(publishStats, pillarCategories);
  logger.info('Article auto-published', {
    articleId,
    context,
    score: scores.overallScore,
    publishStats,
    pillarCategories: pillarCategories.map(category => category.slug),
  });
  return true;
}

async function publishCarryoverCandidates(
  db: ReturnType<typeof getAdminClient>,
  publishStats: PublishStats,
): Promise<{ published: number; failed: number }> {
  const { data, error } = await db
    .from('articles')
    .select(`
      id,
      title,
      canonical_url,
      created_at,
      published_at,
      sources(name),
      article_ai_insights(
        short_summary,
        long_summary,
        tags,
        topics,
        overall_score,
        blog_post_potential_score
      ),
      article_actions(action_type),
      generated_drafts(id)
    `)
    .gte('created_at', getCarryoverCutoff())
    .order('published_at', { ascending: false })
    .limit(CARRYOVER_CANDIDATE_LIMIT);

  if (error) {
    logger.warn('Failed to fetch carryover candidates', { error: error.message });
    return { published: 0, failed: 0 };
  }

  const candidates = (data ?? [])
    .filter((article: any) => {
      const insights = Array.isArray(article.article_ai_insights)
        ? article.article_ai_insights[0]
        : article.article_ai_insights;
      const actions = Array.isArray(article.article_actions) ? article.article_actions : [];
      const alreadyDrafted = actions.some((action: any) => action.action_type === 'generate_blog_draft');
      const hasDraft = Array.isArray(article.generated_drafts)
        ? article.generated_drafts.length > 0
        : Boolean(article.generated_drafts);
      return Number(insights?.overall_score ?? 0) >= AUTO_PUBLISH_THRESHOLD && !alreadyDrafted && !hasDraft;
    })
    .sort((a: any, b: any) => {
      const insightA = Array.isArray(a.article_ai_insights) ? a.article_ai_insights[0] : a.article_ai_insights;
      const insightB = Array.isArray(b.article_ai_insights) ? b.article_ai_insights[0] : b.article_ai_insights;
      const overallDiff = Number(insightB?.overall_score ?? 0) - Number(insightA?.overall_score ?? 0);
      if (overallDiff !== 0) return overallDiff;

      const blogDiff =
        Number(insightB?.blog_post_potential_score ?? 0) -
        Number(insightA?.blog_post_potential_score ?? 0);
      if (blogDiff !== 0) return blogDiff;

      return new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime();
    });

  let published = 0;
  let failed = 0;

  for (const article of candidates) {
    const insights = Array.isArray(article.article_ai_insights)
      ? article.article_ai_insights[0]
      : article.article_ai_insights;
    const sourceName = (article.sources as unknown as { name: string } | null)?.name ?? 'Unknown';
    const scores = {
      overallScore: Number(insights?.overall_score ?? 0),
      blogPostPotentialScore: insights?.blog_post_potential_score,
    };
    const pillarCategories = getPillarCategories([
      article.title,
      article.canonical_url,
      sourceName,
      insights?.short_summary,
      insights?.long_summary,
      ...(insights?.topics ?? []),
      ...(insights?.tags ?? []),
    ]);
    const decision = getPublishDecision(scores, pillarCategories, publishStats);

    if (!decision.shouldAutoPublish) {
      logger.info('Carryover candidate skipped by daily balance policy', {
        articleId: article.id,
        score: scores.overallScore,
        publishStats,
        dailyTarget: DAILY_AUTO_PUBLISH_TARGET,
        dailyPhysicalAiTarget: DAILY_PHYSICAL_AI_TARGET,
        pillarCategories: pillarCategories.map(category => category.slug),
        physicalAiLimitReached: decision.physicalAiLimitReached,
        isExceptional: decision.isExceptional,
      });
      continue;
    }

    try {
      const didPublish = await publishArticle(article.id, scores, pillarCategories, publishStats, 'carryover');
      if (didPublish) published++;
    } catch (err) {
      logger.warn('Carryover auto-publish failed', { articleId: article.id, err: String(err) });
      failed++;
    }
  }

  return { published, failed };
}

// Daily floor: if nothing has published for 24h, publish the single best
// unpublished candidate (>= 8.0) from the carryover window so the site
// never goes a full day without a new article. Quality floor is 8.0 —
// if nothing reaches it, we publish nothing.
async function publishDailyFloorCandidate(
  db: ReturnType<typeof getAdminClient>,
  publishStats: PublishStats,
): Promise<{ published: number }> {
  const { data: lastPublished, error: lastErr } = await db
    .from('generated_drafts')
    .select('created_at')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastErr) {
    logger.warn('Daily floor: failed to check last publish time', { error: lastErr.message });
    return { published: 0 };
  }

  const droughtCutoff = Date.now() - FLOOR_DROUGHT_HOURS * 60 * 60 * 1000;
  if (lastPublished && new Date(lastPublished.created_at).getTime() > droughtCutoff) {
    return { published: 0 };
  }

  const { data, error } = await db
    .from('articles')
    .select(`
      id,
      title,
      canonical_url,
      created_at,
      published_at,
      sources(name),
      article_ai_insights(
        short_summary,
        long_summary,
        tags,
        topics,
        overall_score,
        blog_post_potential_score
      ),
      article_actions(action_type),
      generated_drafts(id)
    `)
    .gte('created_at', getCarryoverCutoff())
    .order('published_at', { ascending: false })
    .limit(CARRYOVER_CANDIDATE_LIMIT);

  if (error) {
    logger.warn('Daily floor: failed to fetch candidates', { error: error.message });
    return { published: 0 };
  }

  const candidates = (data ?? [])
    .filter((article: any) => {
      const insights = Array.isArray(article.article_ai_insights)
        ? article.article_ai_insights[0]
        : article.article_ai_insights;
      const actions = Array.isArray(article.article_actions) ? article.article_actions : [];
      const alreadyDrafted = actions.some((action: any) => action.action_type === 'generate_blog_draft');
      const hasDraft = Array.isArray(article.generated_drafts)
        ? article.generated_drafts.length > 0
        : Boolean(article.generated_drafts);
      return Number(insights?.overall_score ?? 0) >= FLOOR_PUBLISH_THRESHOLD && !alreadyDrafted && !hasDraft;
    })
    .sort((a: any, b: any) => {
      const insightA = Array.isArray(a.article_ai_insights) ? a.article_ai_insights[0] : a.article_ai_insights;
      const insightB = Array.isArray(b.article_ai_insights) ? b.article_ai_insights[0] : b.article_ai_insights;
      const overallDiff = Number(insightB?.overall_score ?? 0) - Number(insightA?.overall_score ?? 0);
      if (overallDiff !== 0) return overallDiff;

      const blogDiff =
        Number(insightB?.blog_post_potential_score ?? 0) -
        Number(insightA?.blog_post_potential_score ?? 0);
      if (blogDiff !== 0) return blogDiff;

      return new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime();
    });

  const article = candidates[0];
  if (!article) {
    logger.info('Daily floor: drought detected but no candidate >= floor', {
      floor: FLOOR_PUBLISH_THRESHOLD,
    });
    return { published: 0 };
  }

  const insights = Array.isArray(article.article_ai_insights)
    ? article.article_ai_insights[0]
    : article.article_ai_insights;
  const sourceName = (article.sources as unknown as { name: string } | null)?.name ?? 'Unknown';
  const scores = {
    overallScore: Number(insights?.overall_score ?? 0),
    blogPostPotentialScore: insights?.blog_post_potential_score,
  };
  const pillarCategories = getPillarCategories([
    article.title,
    article.canonical_url,
    sourceName,
    insights?.short_summary,
    insights?.long_summary,
    ...(insights?.topics ?? []),
    ...(insights?.tags ?? []),
  ]);

  logger.info('Daily floor publish', {
    articleId: article.id,
    score: scores.overallScore,
    droughtHours: FLOOR_DROUGHT_HOURS,
    pillarCategories: pillarCategories.map(category => category.slug),
  });

  try {
    const didPublish = await publishArticle(article.id, scores, pillarCategories, publishStats, 'daily-floor');
    return { published: didPublish ? 1 : 0 };
  } catch (err) {
    logger.warn('Daily floor publish failed', { articleId: article.id, err: String(err) });
    return { published: 0 };
  }
}

async function handler(request: Request): Promise<Response> {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  logger.info('Cron process-articles started');

  const db = getAdminClient();
  const ai = getAiProvider();
  const publishStats = await getPublishStatsToday(db);
  const carryover = await publishCarryoverCandidates(db, publishStats);

  // LEFT JOINで未処理記事を取得（NOT IN方式はID数が多いとURL長制限に引っかかるため）
  const { data: candidates, error } = await db
    .from('articles')
    .select('id, source_id, title, canonical_url, extracted_text, published_at, sources(name, priority), article_ai_insights(article_id)')
    .order('fetched_at', { ascending: false })
    .limit(BATCH_SIZE * 10); // 多めに取得してクライアント側でフィルタ

  if (error) {
    logger.error('Failed to fetch article candidates', { error: error.message });
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // insightsがない記事だけ抽出し、1ソースで処理枠を埋めないようにラウンドロビンで選ぶ
  const unprocessed = (candidates ?? [])
    .filter((a: any) => {
      const ins = a.article_ai_insights;
      return !ins || (Array.isArray(ins) && ins.length === 0) || ins === null;
    });

  const bySource = new Map<string, any[]>();
  for (const article of unprocessed) {
    const sourceId = article.source_id ?? 'unknown';
    const bucket = bySource.get(sourceId) ?? [];
    if (bucket.length < MAX_ARTICLES_PER_SOURCE_PER_BATCH) {
      bucket.push(article);
    }
    bySource.set(sourceId, bucket);
  }

  const sourceBuckets = [...bySource.values()]
    .sort((a, b) => {
      const priorityA = Number((a[0].sources as { priority?: number } | null)?.priority ?? 0);
      const priorityB = Number((b[0].sources as { priority?: number } | null)?.priority ?? 0);
      return priorityB - priorityA;
    });

  const articles: any[] = [];
  for (let i = 0; articles.length < BATCH_SIZE; i++) {
    let added = false;
    for (const bucket of sourceBuckets) {
      const next = bucket[i];
      if (!next) continue;
      articles.push(next);
      added = true;
      if (articles.length >= BATCH_SIZE) break;
    }
    if (!added) break;
  }

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

        const pillarCategories = getPillarCategories([
          article.title,
          article.canonical_url,
          sourceName,
          summary.shortSummary,
          summary.longSummary,
          ...(summary.topics ?? []),
          ...(summary.tags ?? []),
        ]);
        const decision = getPublishDecision(scores, pillarCategories, publishStats);

        if (decision.shouldAutoPublish) {
          logger.info('Score threshold met, auto-publishing', {
            articleId: article.id,
            score: scores.overallScore,
            publishStats,
            pillarCategories: pillarCategories.map(category => category.slug),
            isExceptional: decision.isExceptional,
          });
          try {
            await publishArticle(article.id, scores, pillarCategories, publishStats, 'new');
          } catch (draftErr) {
            logger.warn('Auto-publish failed', { articleId: article.id, err: String(draftErr) });
          }
        } else if (scores.overallScore >= AUTO_PUBLISH_THRESHOLD) {
          logger.info('Auto-publish skipped by daily balance policy', {
            articleId: article.id,
            score: scores.overallScore,
            publishStats,
            dailyTarget: DAILY_AUTO_PUBLISH_TARGET,
            dailyPhysicalAiTarget: DAILY_PHYSICAL_AI_TARGET,
            pillarCategories: pillarCategories.map(category => category.slug),
            physicalAiLimitReached: decision.physicalAiLimitReached,
            isExceptional: decision.isExceptional,
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

  const dailyFloor = await publishDailyFloorCandidate(db, publishStats);

  const result = { ok: true, processed, failed, total: (articles ?? []).length, carryover, dailyFloor, publishStats };
  logger.info('Cron process-articles complete', result);

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
