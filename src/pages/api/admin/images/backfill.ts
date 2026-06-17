// API: Backfill featured images for published posts missing a real image

import type { APIRoute } from 'astro';
import { backfillMissingFeaturedImages } from '@/services/images/backfill';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:backfill-images');

export const POST: APIRoute = async ({ redirect }) => {
  logger.info('Backfilling featured images');

  try {
    const r = await backfillMissingFeaturedImages();
    return redirect(
      `/admin/drafts?img_done=${r.succeeded}&img_fail=${r.failed}&img_left=${r.remaining}`,
    );
  } catch (err) {
    logger.error('Image backfill failed', { err: String(err) });
    return new Response(`Image backfill failed: ${String(err)}`, { status: 500 });
  }
};
