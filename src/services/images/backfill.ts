// Backfill featured images for published posts that still use the placeholder.

import {
  listPublishedPostsWithPlaceholderImage,
  generateAndAttachFeaturedImage,
} from '@/services/wordpress/client';
import { detectPillarCategories } from '@/services/editorial/pillars';
import { createLogger } from '@/lib/logger';

const logger = createLogger('image-backfill');

// Nano Banana Pro takes ~21s and gpt-image-2 ~54s per image; 5 per batch
// (~250s worst normal case) stays under the 300s function ceiling. A
// full-fallback batch could exceed it, but attached images persist and the
// operator just clicks again (idempotent).
const BACKFILL_LIMIT = 5;

export interface BackfillResult {
  totalMissing: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

/**
 * Generate and attach real featured images for up to `limit` published posts
 * that still have the placeholder image. Per-post failures are tallied, not
 * thrown, so one bad post does not abort the batch.
 */
export async function backfillMissingFeaturedImages(
  limit: number = BACKFILL_LIMIT,
): Promise<BackfillResult> {
  const missing = await listPublishedPostsWithPlaceholderImage();
  const totalMissing = missing.length;
  const batch = missing.slice(0, limit);

  let succeeded = 0;
  let failed = 0;
  for (const post of batch) {
    try {
      const pillar = detectPillarCategories([post.title, post.summary])[0]?.slug;
      await generateAndAttachFeaturedImage(post.id, post.title, post.summary, post.slug, pillar);
      succeeded++;
    } catch (err) {
      failed++;
      logger.warn('Backfill image generation failed', { postId: post.id, err: String(err) });
    }
  }

  const remaining = totalMissing - succeeded;
  logger.info('Backfill batch complete', { totalMissing, succeeded, failed, remaining });
  return { totalMissing, succeeded, failed, remaining };
}
