// Topic-directed draft composition for the personal blog (ichikarablog).
// Research → voice retrieval → draft → image → WordPress DRAFT. Never publishes.

import { getAdminClient } from '@/lib/supabase/server';
import { researchTopic } from '@/services/research/websearch';
import { getStyleChunksForDraft } from '@/services/rag/retrieval';
import { ICHIKARA_CORPUS } from '@/services/rag/blog-import';
import { generateTopicDraftWithClaude } from '@/services/ai/anthropic';
import {
  createWordPressDraft,
  generateAndAttachFeaturedImage,
  getOrCreateWordPressCategory,
  getOrCreateWordPressTag,
  publishWordPressPost,
} from '@/services/wordpress/client';
import { resolveWordPressTarget } from '@/services/wordpress/target';
import { createLogger } from '@/lib/logger';
import type { ResearchSource } from '@/types/ai';

const logger = createLogger('compose');

const WP_TARGET = 'ichikarablog' as const;

export interface ComposeInput {
  topic: string;
  angle?: string;
  /** Ids of existing ichikarablog categories checked in the picker. */
  categoryIds?: number[];
  /** Display names aligned with categoryIds, for the composed_drafts.category label. */
  categoryNames?: string[];
  /** A brand-new category name typed alongside the picker (WordPress's "+ new category"). */
  newCategoryName?: string;
  /** Comma-separated tag names, as typed into the free-text tag input. */
  tags?: string;
}

export interface ComposeResult {
  id: string;
  wpPostId: number | null;
  title: string;
  status: 'draft' | 'failed';
  sources: ResearchSource[];
}

export async function composeDraftForTopic(input: ComposeInput): Promise<ComposeResult> {
  const db = getAdminClient();
  const {
    topic,
    angle,
    categoryIds: selectedCategoryIds = [],
    categoryNames: selectedCategoryNames = [],
    newCategoryName,
    tags: tagsRaw,
  } = input;

  logger.info('Composing draft', {
    topic: topic.slice(0, 80),
    categoryIds: selectedCategoryIds,
    newCategoryName,
    tags: tagsRaw,
  });

  // 1. Research. Failing research must not kill the draft — we fall back to
  //    model knowledge and say so in the post.
  let findings = '';
  let sources: ResearchSource[] = [];
  try {
    const research = await researchTopic(topic, angle);
    findings = research.findings;
    sources = research.sources;
  } catch (err) {
    logger.warn('Topic research failed, continuing without live sources', {
      topic: topic.slice(0, 80),
      err: String(err),
    });
  }

  // 2. Voice: retrieve the writer's own past chunks from the ichikarablog corpus.
  const styleChunks = await getStyleChunksForDraft(topic, angle ? [angle] : [], ICHIKARA_CORPUS);

  // 3. Draft.
  const draft = await generateTopicDraftWithClaude({
    topic,
    angle,
    findings,
    sources,
    styleChunks,
  });

  const title = draft.titleOptions[0];
  const target = resolveWordPressTarget(WP_TARGET);

  // 4. Categories (optional, best-effort). Existing picked ids pass through
  //    as-is; a typed new-category name is created on ichikarablog and its id
  //    appended. A failure here must never fail the whole draft.
  const categoryIds: number[] = [...selectedCategoryIds];
  const categoryLabelParts: string[] = [...selectedCategoryNames];

  const newCategory = newCategoryName?.trim();
  if (newCategory) {
    try {
      const categoryId = await getOrCreateWordPressCategory(
        newCategory,
        newCategory,
        undefined,
        target,
      );
      categoryIds.push(categoryId);
      categoryLabelParts.push(newCategory);
    } catch (err) {
      logger.warn('New category creation failed, posting without it', {
        newCategory,
        err: String(err),
      });
    }
  }

  const categoryLabel = categoryLabelParts.length > 0 ? categoryLabelParts.join(', ') : null;

  // 4b. Tags (optional, best-effort). Comma-separated names are resolved to
  //     ids, creating any tag that doesn't already exist. A failure to
  //     resolve any one tag must never fail the whole draft.
  const tagNames = (tagsRaw ?? '')
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);

  const tagIds: number[] = [];
  for (const name of tagNames) {
    try {
      const tagId = await getOrCreateWordPressTag(name, target);
      tagIds.push(tagId);
    } catch (err) {
      logger.warn('Tag resolution failed, posting without it', { name, err: String(err) });
    }
  }

  // 5. Record the draft in the DB first, so it is the system of record even
  //    if we crash before (or during) the WordPress call. `status: 'failed'`
  //    here means "not yet successfully posted" — the terminal state if we
  //    die before step 6 succeeds, and already the status the UI treats as
  //    retryable.
  const { data: inserted, error: insertError } = await db
    .from('composed_drafts')
    .insert({
      topic,
      angle: angle ?? null,
      title,
      outline: draft.outline,
      body: draft.body,
      source_urls: sources,
      wp_target: WP_TARGET,
      wp_post_id: null,
      category: categoryLabel,
      status: 'failed',
      error: null,
    })
    .select('id')
    .single();

  if (insertError) {
    logger.error('composed_drafts insert failed', { error: insertError.message });
    throw new Error(`Draft could not be recorded: ${insertError.message}`);
  }

  const id = inserted.id;

  // 6. Post as a DRAFT on ichikarablog.
  let wpPostId: number | null = null;
  let status: 'draft' | 'failed' = 'draft';
  let errorMessage: string | null = null;

  try {
    const post = await createWordPressDraft(
      title,
      draft.body,
      undefined,
      draft.slug,
      'draft',
      categoryIds.length > 0 ? categoryIds : undefined,
      undefined,
      target,
      tagIds.length > 0 ? tagIds : undefined,
    );
    wpPostId = post.id;
  } catch (err) {
    status = 'failed';
    errorMessage = String(err);
    logger.error('ichikarablog draft post failed', { err: errorMessage });
  }

  const { error: updateError } = await db
    .from('composed_drafts')
    .update({
      wp_post_id: wpPostId,
      status,
      error: errorMessage,
    })
    .eq('id', id);

  if (updateError) {
    logger.error('composed_drafts update failed', { id, error: updateError.message });
  }

  // 7. Featured image (best effort — a missing image never fails the draft).
  if (wpPostId !== null) {
    try {
      await generateAndAttachFeaturedImage(
        wpPostId,
        title,
        findings.slice(0, 150),
        draft.slug,
        undefined,
        target,
      );
    } catch (err) {
      logger.warn('Featured image failed, draft kept without image', {
        wpPostId,
        err: String(err),
      });
    }
  }

  logger.info('Compose complete', { id, wpPostId, status, sources: sources.length });

  return { id, wpPostId, title, status, sources };
}

// Flip a composed draft to published on ichikarablog. Idempotent.
export async function publishComposedDraft(id: string): Promise<{ link: string }> {
  const db = getAdminClient();

  const { data: row, error } = await db
    .from('composed_drafts')
    .select('id, wp_post_id, status')
    .eq('id', id)
    .single();

  if (error || !row) throw new Error('Composed draft not found');
  if (row.wp_post_id === null) throw new Error('This draft was never posted to WordPress');

  const target = resolveWordPressTarget(WP_TARGET);

  let link: string;
  try {
    ({ link } = await publishWordPressPost(row.wp_post_id, target));
  } catch (err) {
    const message = String(err);
    logger.error('Publish to WordPress failed', { id, wpPostId: row.wp_post_id, err: message });
    const { error: updateError } = await db
      .from('composed_drafts')
      .update({ error: message })
      .eq('id', id);
    if (updateError) {
      logger.error('composed_drafts failure update failed', { id, error: updateError.message });
    }
    throw err;
  }

  if (row.status !== 'published') {
    await db
      .from('composed_drafts')
      .update({ status: 'published', published_at: new Date().toISOString(), error: null })
      .eq('id', id);
  }

  logger.info('Composed draft published', { id, wpPostId: row.wp_post_id, link });
  return { link };
}
