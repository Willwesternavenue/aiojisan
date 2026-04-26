// Shared draft generation logic (used by API route and cron)

import { getAdminClient } from '@/lib/supabase/server';
import { getAiProvider } from '@/services/ai';
import { getStyleChunksForDraft } from '@/services/rag/retrieval';
import {
  createWordPressDraft,
  generateAndAttachFeaturedImage,
  getOrCreateWordPressCategory,
} from '@/services/wordpress/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('draft-generator');

const PHYSICAL_AI_CATEGORY = {
  name: 'フィジカルAI',
  slug: 'physical-ai',
  description: 'ロボット、身体性、自動運転、製造現場など、現実世界で動くAIに関する記事',
};

const PHYSICAL_AI_KEYWORDS = [
  'フィジカルai',
  'physical ai',
  'robot',
  'robotics',
  'robotic',
  'humanoid',
  'android',
  'embodied ai',
  'world model',
  'spatial intelligence',
  'ロボット',
  'ロボティクス',
  'ヒューマノイド',
  '人型ロボット',
  '身体性',
  '具身化',
  '実世界',
  '自動運転',
  'ドローン',
  '製造現場',
  '工場',
  '倉庫',
];

function isPhysicalAiArticle(fields: Array<string | null | undefined>): boolean {
  const haystack = fields
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  return PHYSICAL_AI_KEYWORDS.some(keyword => haystack.includes(keyword));
}

export async function generateDraftForArticle(
  articleId: string,
  options: { autoPublish?: boolean } = {},
): Promise<{ wpPostId: number } | null> {
  const db = getAdminClient();
  const ai = getAiProvider();

  // Check if draft already exists
  const { data: existing } = await db
    .from('article_actions')
    .select('id')
    .eq('article_id', articleId)
    .eq('action_type', 'generate_blog_draft')
    .maybeSingle();

  if (existing) {
    logger.info('Draft already exists, skipping', { articleId });
    return null;
  }

  const { data: article, error } = await db
    .from('articles')
    .select('*, article_ai_insights(*)')
    .eq('id', articleId)
    .single();

  if (error || !article) {
    logger.warn('Article not found', { articleId });
    return null;
  }

  const insights = article.article_ai_insights;
  const { autoPublish = false } = options;

  logger.info('Generating draft', { articleId, title: article.title, autoPublish });

  const styleChunks = await getStyleChunksForDraft(
    article.title,
    insights?.topics ?? [],
  );

  const draft = await ai.generateBlogDraft({
    articleTitle: article.title,
    articleUrl: article.canonical_url,
    articleText: article.extracted_text ?? '',
    shortSummary: insights?.short_summary ?? '',
    longSummary: insights?.long_summary ?? '',
    topics: insights?.topics ?? [],
    styleChunks,
  });

  const selectedTitle = draft.titleOptions[0];
  const wpStatus = autoPublish ? 'publish' : 'draft';
  const categoryIds: number[] = [];

  if (isPhysicalAiArticle([
    article.title,
    article.canonical_url,
    insights?.short_summary,
    insights?.long_summary,
    ...(insights?.topics ?? []),
    ...(insights?.tags ?? []),
  ])) {
    try {
      const categoryId = await getOrCreateWordPressCategory(
        PHYSICAL_AI_CATEGORY.name,
        PHYSICAL_AI_CATEGORY.slug,
        PHYSICAL_AI_CATEGORY.description,
      );
      categoryIds.push(categoryId);
    } catch (categoryErr) {
      logger.warn('Physical AI category assignment failed', {
        articleId,
        err: String(categoryErr),
      });
    }
  }

  const { id: wpPostId } = await createWordPressDraft(
    selectedTitle,
    draft.body,
    insights?.short_summary ?? undefined,
    draft.slug,
    wpStatus,
    categoryIds,
  );

  // Generate and attach featured image for auto-published articles only
  if (autoPublish) {
    try {
      await generateAndAttachFeaturedImage(
        wpPostId,
        selectedTitle,
        insights?.short_summary ?? '',
        draft.slug,
      );
    } catch (imgErr) {
      logger.warn('Featured image generation failed, post already published without image', {
        articleId,
        wpPostId,
        err: String(imgErr),
      });
    }
  }

  await db.from('generated_drafts').insert({
    article_id: articleId,
    draft_title: selectedTitle,
    draft_outline: draft.outline,
    draft_body: draft.body,
    wordpress_post_id: wpPostId,
    status: autoPublish ? 'published' : 'sent_to_wordpress',
    generation_metadata: {
      titleOptions: draft.titleOptions,
      styleChunksUsed: styleChunks.length,
      model: 'gpt-4o',
      auto_generated: true,
      auto_published: autoPublish,
    },
  });

  await db.from('article_actions').insert({
    article_id: articleId,
    action_type: 'generate_blog_draft',
  });

  logger.info('Draft processed', { articleId, wpPostId, title: selectedTitle, status: wpStatus });
  return { wpPostId };
}
