// API: Run AI analysis on a single article

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase/server';
import { getAiProvider } from '@/services/ai';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:analyze');

export const POST: APIRoute = async (context) => {
  const authError = await requireAdminSession(context);
  if (authError) return authError;

  const { request, redirect } = context;
  const formData = await request.formData();
  const articleId = formData.get('article_id') as string | null;

  if (!articleId) {
    return new Response('Missing article_id', { status: 400 });
  }

  const db = getAdminClient();
  const ai = getAiProvider();

  const { data: article, error } = await db
    .from('articles')
    .select('id, title, canonical_url, extracted_text, published_at, sources(name)')
    .eq('id', articleId)
    .single();

  if (error || !article) {
    return new Response('Article not found', { status: 404 });
  }

  try {
    const sourceName = (article.sources as unknown as { name: string } | null)?.name ?? 'Unknown';

    const summary = await ai.summarizeArticle({
      title: article.title,
      url: article.canonical_url,
      extractedText: article.extracted_text ?? '',
      publishedAt: article.published_at,
      sourceName,
    });

    const scores = await ai.scoreArticle({
      title: article.title,
      url: article.canonical_url,
      extractedText: article.extracted_text ?? '',
      publishedAt: article.published_at,
      sourceName,
      summary: summary.shortSummary,
    });

    const { error: upsertError } = await db.from('article_ai_insights').upsert({
      article_id: articleId,
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
    }, { onConflict: 'article_id' });

    if (upsertError) {
      logger.error('Insights upsert failed', { articleId, error: upsertError.message });
      return new Response(`DB error: ${upsertError.message}`, { status: 500 });
    }

    logger.info('Article analyzed', { articleId, score: scores.overallScore });
  } catch (err) {
    logger.error('AI analysis failed', { articleId, err: String(err) });
    return new Response(`AI error: ${String(err)}`, { status: 500 });
  }

  return redirect(`/admin/feed/${articleId}`);
};
