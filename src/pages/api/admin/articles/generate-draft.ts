// API: Generate blog draft for an article

import type { APIRoute } from 'astro';
import { getAdminClient } from '@/lib/supabase/server';
import { getAiProvider } from '@/services/ai';
import { getStyleChunksForDraft } from '@/services/rag/retrieval';
import { createWordPressDraft } from '@/services/wordpress/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:generate-draft');

export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();
  const articleId = formData.get('article_id') as string;

  if (!articleId) {
    return new Response('Missing article_id', { status: 400 });
  }

  const db = getAdminClient();
  const ai = getAiProvider();

  // 1. Fetch article + insights
  const { data: article, error } = await db
    .from('articles')
    .select('*, article_ai_insights(*)')
    .eq('id', articleId)
    .single();

  if (error || !article) {
    return new Response('Article not found', { status: 404 });
  }

  const insights = article.article_ai_insights;

  logger.info('Generating draft', { articleId, title: article.title });

  try {
    // 2. Retrieve RAG style chunks
    const styleChunks = await getStyleChunksForDraft(
      article.title,
      insights?.topics ?? [],
    );

    // 3. Generate draft
    const draft = await ai.generateBlogDraft({
      articleTitle: article.title,
      articleUrl: article.canonical_url,
      articleText: article.extracted_text ?? '',
      shortSummary: insights?.short_summary ?? '',
      longSummary: insights?.long_summary ?? '',
      topics: insights?.topics ?? [],
      styleChunks,
    });

    // 4. Send to WordPress as draft
    const selectedTitle = draft.titleOptions[0];
    const { id: wpPostId } = await createWordPressDraft(
      selectedTitle,
      draft.body,
      insights?.short_summary ?? undefined,
    );

    // 5. Store in database
    await db.from('generated_drafts').insert({
      article_id: articleId,
      draft_title: selectedTitle,
      draft_outline: draft.outline,
      draft_body: draft.body,
      wordpress_post_id: wpPostId,
      status: 'sent_to_wordpress',
      generation_metadata: {
        titleOptions: draft.titleOptions,
        styleChunksUsed: styleChunks.length,
        model: 'gpt-4o',
      },
    });

    // 6. Record action
    await db.from('article_actions').insert({
      article_id: articleId,
      action_type: 'generate_blog_draft',
    });

    logger.info('Draft generated and sent to WordPress', { articleId, wpPostId });

    return redirect(`/admin/feed/${articleId}`);
  } catch (err) {
    logger.error('Draft generation failed', { articleId, err: String(err) });
    return new Response(`Draft generation failed: ${String(err)}`, { status: 500 });
  }
};
