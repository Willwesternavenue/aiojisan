// API: import WordPress posts into the style corpus (resumable).
// Protected by CRON_SECRET because it spends embedding credits.
// Defaults to the ichikarablog target so existing callers (cron jobs,
// bookmarks, etc.) keep behaving exactly as before this endpoint could
// target either blog.

import type { APIRoute } from 'astro';
import { requireCronAuth } from '@/lib/auth';
import { importBlogPosts, type BlogImportTarget } from '@/services/rag/blog-import';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:ichikara-import');

const VALID_TARGETS: BlogImportTarget[] = ['aiojisan', 'ichikarablog'];

export const POST: APIRoute = async ({ request }) => {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  let limit = 1;
  let startPage = 1;
  let target: BlogImportTarget = 'ichikarablog';
  try {
    const body = (await request.json()) as { limit?: number; start_page?: number; target?: string };
    if (typeof body.limit === 'number') limit = Math.min(Math.max(1, body.limit), 2);
    if (typeof body.start_page === 'number') startPage = Math.max(1, body.start_page);
    if (typeof body.target === 'string') {
      if (!VALID_TARGETS.includes(body.target as BlogImportTarget)) {
        return new Response(
          JSON.stringify({ ok: false, error: `Unknown target "${body.target}"; expected one of ${VALID_TARGETS.join(', ')}` }),
          { status: 400, headers: { 'Content-Type': 'application/json' } },
        );
      }
      target = body.target as BlogImportTarget;
    }
  } catch {
    // defaults are fine
  }

  try {
    const result = await importBlogPosts(target, { limit, startPage });
    return new Response(JSON.stringify({ ok: true, target, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    logger.error('blog import failed', { target, err: String(err) });
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
