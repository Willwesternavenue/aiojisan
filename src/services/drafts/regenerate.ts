// Regenerate an existing article's body with the current prompt and overwrite
// the same WordPress post in place (URL / slug / title unchanged).

import { getAdminClient } from '@/lib/supabase/server';
import { updateWordPressDraft } from '@/services/wordpress/client';
import { buildBlogDraftForArticle } from './content';
import { createLogger } from '@/lib/logger';

const logger = createLogger('draft-regenerator');

export async function regenerateDraftForArticle(
  articleId: string,
): Promise<{ wpPostId: number }> {
  const db = getAdminClient();

  // 1. Most recent stored draft for this article (gives us the WP post + title)
  const { data: draftRow, error: draftErr } = await db
    .from('generated_drafts')
    .select('id, draft_title, wordpress_post_id')
    .eq('article_id', articleId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (draftErr || !draftRow) {
    throw new Error(`No existing draft found for article ${articleId}`);
  }
  if (!draftRow.wordpress_post_id) {
    throw new Error(`Draft for article ${articleId} has no WordPress post to update`);
  }

  // 2. Article + insights
  const { data: article, error: articleErr } = await db
    .from('articles')
    .select('*, article_ai_insights(*)')
    .eq('id', articleId)
    .single();

  if (articleErr || !article) {
    throw new Error(`Article ${articleId} not found`);
  }

  logger.info('Regenerating draft', { articleId, wpPostId: draftRow.wordpress_post_id });

  // 3. Fresh content via the shared helper
  const { draft, styleChunksUsed } = await buildBlogDraftForArticle(article);

  // 4. Overwrite WordPress body, keeping the existing title (slug stays untouched)
  await updateWordPressDraft(draftRow.wordpress_post_id, draftRow.draft_title, draft.body);

  // 5. Update the stored draft row
  await db
    .from('generated_drafts')
    .update({
      draft_body: draft.body,
      draft_outline: draft.outline,
      generation_metadata: {
        styleChunksUsed,
        model: draft.model,
        regenerated: true,
        regenerated_at: new Date().toISOString(),
      },
    })
    .eq('id', draftRow.id);

  // 6. Record the action
  await db.from('article_actions').insert({
    article_id: articleId,
    action_type: 'regenerate_blog_draft',
  });

  logger.info('Draft regenerated', { articleId, wpPostId: draftRow.wordpress_post_id });
  return { wpPostId: draftRow.wordpress_post_id };
}
