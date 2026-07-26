// API: Generate X post drafts for an article

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase/server';
import { getAiProvider } from '@/services/ai';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:generate-x-posts');

export const POST: APIRoute = async (context) => {
  const authError = await requireAdminSession(context);
  if (authError) return authError;

  const { request, redirect } = context;
  const formData = await request.formData();
  const articleId = formData.get('article_id') as string;

  if (!articleId) return new Response('Missing article_id', { status: 400 });

  const db = getAdminClient();
  const ai = getAiProvider();

  const { data: article } = await db
    .from('articles')
    .select('*, article_ai_insights(*)')
    .eq('id', articleId)
    .single();

  if (!article) return new Response('Article not found', { status: 404 });

  const insights = article.article_ai_insights;

  logger.info('Generating X posts', { articleId });

  try {
    const posts = await ai.generateXPosts({
      articleTitle: article.title,
      articleUrl: article.canonical_url,
      shortSummary: insights?.short_summary ?? '',
      topics: insights?.topics ?? [],
    });

    // Delete previous X posts for this article (regenerate)
    await db.from('generated_x_posts').delete().eq('article_id', articleId);

    // Insert 3 variants
    await db.from('generated_x_posts').insert([
      { article_id: articleId, variant_label: 'direct',     text: posts.direct,     tone: '直球型' },
      { article_id: articleId, variant_label: 'analytical', text: posts.analytical, tone: '分析型' },
      { article_id: articleId, variant_label: 'opinion',    text: posts.opinion,    tone: '意見型' },
    ]);

    await db.from('article_actions').insert({
      article_id: articleId,
      action_type: 'generate_x_post',
    });

    return redirect(`/admin/feed/${articleId}`);
  } catch (err) {
    logger.error('X post generation failed', { articleId, err: String(err) });
    return new Response(`X post generation failed: ${String(err)}`, { status: 500 });
  }
};
