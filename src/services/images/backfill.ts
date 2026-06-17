// Backfill featured images for published posts that still use the placeholder.

import {
  listPublishedPostsWithPlaceholderImage,
  generateAndAttachFeaturedImage,
} from '@/services/wordpress/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('image-backfill');

// Gemini 3.1 Flash Image takes ~13s; 10 × ~13s ≈ 130s stays comfortably under
// the 300s function ceiling so the request always completes and redirects.
const BACKFILL_LIMIT = 10;

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
      await generateAndAttachFeaturedImage(post.id, post.title, post.summary, post.slug);
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
