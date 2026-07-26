// Resumable import of published WordPress posts into the style corpus.
// Supports both blogs this app drafts for: the AIおじさん business blog
// (WORDPRESS_BASE_URL, corpus 'aiojisan') and the personal ichikarablog.com
// (ICHIKARA_WP_BASE_URL, corpus 'ichikarablog'). Runs page by page so a
// serverless invocation never has to embed a whole backlog in one go — the
// caller keeps posting until nextPage is null.
//
// The two blogs' source_post_id values must never collide, since
// blog_style_chunks has a UNIQUE (source_post_id, chunk_index) constraint
// that is not scoped by corpus. Each target gets its own id prefix — do not
// change 'ichikara-' without a migration, since posts are already imported
// under that prefix.

import { getEnv } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { ingestBlogPosts, type RawBlogPost } from './ingest';

const logger = createLogger('blog-import');

export type BlogImportTarget = 'aiojisan' | 'ichikarablog';

// Kept for existing importers (src/services/drafts/compose.ts filters style
// retrieval to this corpus) — must keep resolving to 'ichikarablog'.
export const ICHIKARA_CORPUS = 'ichikarablog';

const PER_PAGE = 10;

interface WpPost {
  id: number;
  link: string;
  date_gmt: string;
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
}

interface BlogImportConfig {
  baseUrl: string;
  corpus: string;
  idPrefix: string;
}

function resolveBlogImportConfig(target: BlogImportTarget): BlogImportConfig {
  if (target === 'aiojisan') {
    // Required by the env schema, so this is always set.
    const baseUrl = getEnv().WORDPRESS_BASE_URL;
    return { baseUrl, corpus: 'aiojisan', idPrefix: 'aiojisan-' };
  }

  if (target === 'ichikarablog') {
    // This importer only reads public posts over an unauthenticated fetch,
    // so it needs the base URL alone — it must not fail on missing
    // WordPress credentials (username/app password) it never sends.
    const baseUrl = getEnv().ICHIKARA_WP_BASE_URL;
    if (!baseUrl) {
      throw new Error('ICHIKARA_WP_BASE_URL is not set; the ichikarablog importer requires only the base URL');
    }
    return { baseUrl, corpus: 'ichikarablog', idPrefix: 'ichikara-' };
  }

  throw new Error(`Unknown blog import target: ${target as string}`);
}

export async function importBlogPosts(
  target: BlogImportTarget,
  options: { limit?: number; startPage?: number } = {},
): Promise<{ posts: number; chunks: number; nextPage: number | null }> {
  const { limit = 1, startPage = 1 } = options;
  const { baseUrl, corpus, idPrefix } = resolveBlogImportConfig(target);
  const apiBase = `${baseUrl.replace(/\/$/, '')}/wp-json/wp/v2`;

  let page = startPage;
  let importedPosts = 0;
  let importedChunks = 0;
  let nextPage: number | null = null;

  for (let i = 0; i < limit; i++) {
    const url =
      `${apiBase}/posts?status=publish&per_page=${PER_PAGE}&page=${page}` +
      `&orderby=date&order=desc&_fields=id,link,date_gmt,title,content,excerpt`;

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      // WordPress returns 400 rest_post_invalid_page_number when paging past
      // the end — that means we are done. Any other non-OK response (a
      // transient error, auth failure, etc.) must still throw, or a
      // mid-backlog failure would silently truncate the resumable cursor.
      if (res.status === 400 && body.includes('invalid_page_number')) {
        logger.info('Reached the end of posts', { target, page });
        nextPage = null;
        break;
      }
      throw new Error(`${target} fetch failed ${res.status}: ${body}`);
    }

    const batch = (await res.json()) as WpPost[];
    if (batch.length === 0) {
      nextPage = null;
      break;
    }

    const posts: RawBlogPost[] = batch.map(p => ({
      id: `${idPrefix}${p.id}`,
      title: p.title.rendered,
      url: p.link,
      published_at: p.date_gmt ? `${p.date_gmt}Z` : null,
      content: p.content.rendered,
      excerpt: p.excerpt.rendered,
    }));

    const chunks = await ingestBlogPosts(posts, corpus);
    importedPosts += posts.length;
    importedChunks += chunks;

    logger.info('page imported', { target, page, posts: posts.length, chunks });

    if (batch.length < PER_PAGE) {
      nextPage = null;
      break;
    }
    page++;
    nextPage = page;
  }

  return { posts: importedPosts, chunks: importedChunks, nextPage };
}
