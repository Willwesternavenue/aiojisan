// Shared draft generation logic (used by API route and cron)

import { getAdminClient } from '@/lib/supabase/server';
import { getAiProvider } from '@/services/ai';
import { buildBlogDraftForArticle } from './content';
import {
  createWordPressDraft,
  generateAndAttachFeaturedImage,
  getOrCreateWordPressCategory,
} from '@/services/wordpress/client';
import { postToX } from '@/services/social/x';
import { detectPillarCategories, type PillarCategory } from '@/services/editorial/pillars';
import { createLogger } from '@/lib/logger';

const logger = createLogger('draft-generator');

function getPublicArticleUrl(slug: string): string {
  return `https://www.aiojisan.com/articles/${slug}`;
}

function getHashtags(categories: PillarCategory[]): string[] {
  const tags = new Set<string>(['#AIおじさん']);

  for (const category of categories) {
    if (category.slug === 'physical-ai') tags.add('#フィジカルAI');
    if (category.slug === 'ai-driven-development') tags.add('#AI駆動開発');
    if (category.slug === 'generative-ai-news') tags.add('#生成AI');
  }

  return [...tags].slice(0, 4);
}

function formatXPost(text: string, url: string, hashtags: string[]): string {
  const withoutUrl = text
    .replace(url, '')
    .replace(/https:\/\/www\.aiojisan\.com\/articles\/\S+/g, '')
    .replace(/https?:\/\/\S+/g, '')
    .replace(/#[^\s#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const tagLine = hashtags.join(' ');
  const suffix = `\n\n${url}\n${tagLine}`;
  const maxBodyLength = 280 - suffix.length;
  const body = withoutUrl.length > maxBodyLength
    ? `${withoutUrl.slice(0, Math.max(0, maxBodyLength - 1)).trim()}…`
    : withoutUrl;

  return `${body}${suffix}`.trim();
}

export async function generateDraftForArticle(
  articleId: string,
  options: { autoPublish?: boolean; publishDate?: string; skipSocial?: boolean } = {},
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
  const { autoPublish = false, publishDate, skipSocial = false } = options;

  logger.info('Generating draft', { articleId, title: article.title, autoPublish });

  const { draft, styleChunksUsed } = await buildBlogDraftForArticle(article);

  const selectedTitle = draft.titleOptions[0];
  const wpStatus = autoPublish ? 'publish' : 'draft';
  const categoryIds: number[] = [];

  const pillarCategories = detectPillarCategories([
    article.title,
    article.canonical_url,
    insights?.short_summary,
    insights?.long_summary,
    ...(insights?.topics ?? []),
    ...(insights?.tags ?? []),
  ]);

  for (const category of pillarCategories) {
    try {
      const categoryId = await getOrCreateWordPressCategory(
        category.name,
        category.slug,
        category.description,
      );
      categoryIds.push(categoryId);
    } catch (categoryErr) {
      logger.warn('Pillar category assignment failed', {
        articleId,
        category: category.slug,
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
    publishDate,
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

    if (!skipSocial) {
      try {
        const publicUrl = getPublicArticleUrl(draft.slug);
        const xPosts = await ai.generateXPosts({
          articleTitle: selectedTitle,
          articleUrl: publicUrl,
          shortSummary: insights?.short_summary ?? '',
          topics: insights?.topics ?? [],
        });
        const text = formatXPost(xPosts.direct, publicUrl, getHashtags(pillarCategories));
        const result = await postToX({ text, articleId, url: publicUrl });

        await db.from('generated_x_posts').insert({
          article_id: articleId,
          variant_label: 'direct',
          text,
          tone: result.tweeted ? '自動投稿済み' : '自動投稿スキップ',
        });
      } catch (xErr) {
        logger.warn('X auto-post failed, post already published', {
          articleId,
          wpPostId,
          err: String(xErr),
        });
      }
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
      styleChunksUsed,
      model: draft.model,
      auto_generated: true,
      auto_published: autoPublish,
      backfilled: Boolean(publishDate),
      pillarCategories: pillarCategories.map(category => category.slug),
    },
  });

  await db.from('article_actions').insert({
    article_id: articleId,
    action_type: 'generate_blog_draft',
  });

  logger.info('Draft processed', { articleId, wpPostId, title: selectedTitle, status: wpStatus });
  return { wpPostId };
}
