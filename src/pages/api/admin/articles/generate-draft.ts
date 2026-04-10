// API: Generate blog draft for an article

import type { APIRoute } from 'astro';
import { generateDraftForArticle } from '@/services/drafts/generate';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:generate-draft');

export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();
  const articleId = formData.get('article_id') as string;

  if (!articleId) {
    return new Response('Missing article_id', { status: 400 });
  }

  logger.info('Generating draft', { articleId });

  try {
    await generateDraftForArticle(articleId);
    return redirect(`/admin/feed/${articleId}`);
  } catch (err) {
    logger.error('Draft generation failed', { articleId, err: String(err) });
    return new Response(`Draft generation failed: ${String(err)}`, { status: 500 });
  }
};
