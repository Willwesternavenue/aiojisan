// API: Regenerate the body of an existing article and overwrite its WP post

import type { APIRoute } from 'astro';
import { regenerateDraftForArticle } from '@/services/drafts/regenerate';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:regenerate-draft');

export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();
  const articleId = formData.get('article_id') as string;

  if (!articleId) {
    return new Response('Missing article_id', { status: 400 });
  }

  logger.info('Regenerating draft', { articleId });

  try {
    await regenerateDraftForArticle(articleId);
    return redirect('/admin/drafts?regenerated=1');
  } catch (err) {
    logger.error('Draft regeneration failed', { articleId, err: String(err) });
    return new Response(`Draft regeneration failed: ${String(err)}`, { status: 500 });
  }
};
