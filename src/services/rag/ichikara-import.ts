// One-off (resumable) import of ichikarablog.com posts into the style corpus.
// Runs page by page so a serverless invocation never has to embed ~1000 posts
// in one go — the caller keeps posting until nextPage is null.

import { resolveWordPressTarget } from '@/services/wordpress/target';
import { createLogger } from '@/lib/logger';
import { ingestBlogPosts, type RawBlogPost } from './ingest';

const logger = createLogger('ichikara-import');

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

export async function importIchikaraPosts(
  options: { limit?: number; startPage?: number } = {},
): Promise<{ posts: number; chunks: number; nextPage: number | null }> {
  const { limit = 1, startPage = 1 } = options;
  const target = resolveWordPressTarget('ichikarablog');
  const apiBase = `${target.baseUrl.replace(/\/$/, '')}/wp-json/wp/v2`;

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
        logger.info('Reached the end of ichikarablog posts', { page });
        nextPage = null;
        break;
      }
      throw new Error(`ichikarablog fetch failed ${res.status}: ${body}`);
    }

    const batch = (await res.json()) as WpPost[];
    if (batch.length === 0) {
      nextPage = null;
      break;
    }

    const posts: RawBlogPost[] = batch.map(p => ({
      id: `ichikara-${p.id}`,
      title: p.title.rendered,
      url: p.link,
      published_at: p.date_gmt ? `${p.date_gmt}Z` : null,
      content: p.content.rendered,
      excerpt: p.excerpt.rendered,
    }));

    const chunks = await ingestBlogPosts(posts, ICHIKARA_CORPUS);
    importedPosts += posts.length;
    importedChunks += chunks;

    logger.info('ichikarablog page imported', { page, posts: posts.length, chunks });

    if (batch.length < PER_PAGE) {
      nextPage = null;
      break;
    }
    page++;
    nextPage = page;
  }

  return { posts: importedPosts, chunks: importedChunks, nextPage };
}
