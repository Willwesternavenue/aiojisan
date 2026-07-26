// WordPress REST API client
// Uses Application Password auth — server-only

import { marked } from 'marked';
import { getEnv } from '@/lib/env';
import { resolveWordPressTarget, type WordPressTarget } from './target';
import { generateFeaturedImageBuffer } from '@/services/images/provider';
import { createLogger } from '@/lib/logger';

// Convert markdown to WordPress-friendly HTML
function markdownToHtml(markdown: string): string {
  marked.setOptions({ breaks: true });
  const html = marked.parse(markdown) as string;
  return html;
}

const logger = createLogger('wordpress');

// Placeholder featured image used until a real image is generated
const PLACEHOLDER_MEDIA_ID = 125;

interface WpPostPayload {
  title: string;
  content: string;
  status: 'draft' | 'publish' | 'private';
  excerpt?: string;
  categories?: number[];
  tags?: number[];
  featured_media?: number;
  meta?: Record<string, unknown>;
  date_gmt?: string;
}

interface WpPostResponse {
  id: number;
  link: string;
  status: string;
  title: { rendered: string };
}

interface WpMediaResponse {
  id: number;
  source_url: string;
}

interface WpCategoryResponse {
  id: number;
  name: string;
  slug: string;
}

function getAuthHeader(target: WordPressTarget): string {
  const credentials = `${target.username}:${target.appPassword}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

function getApiBase(target: WordPressTarget): string {
  return `${target.baseUrl.replace(/\/$/, '')}/wp-json/wp/v2`;
}

async function wpFetch<T>(
  path: string,
  options: RequestInit = {},
  target: WordPressTarget = resolveWordPressTarget(),
): Promise<T> {
  const url = `${getApiBase(target)}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': getAuthHeader(target),
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WordPress API error ${res.status} (${target.name}): ${body}`);
  }

  return res.json() as Promise<T>;
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function createWordPressDraft(
  title: string,
  body: string,
  excerpt?: string,
  slug?: string,
  status: 'draft' | 'publish' = 'draft',
  categories?: number[],
  publishDate?: string,
  target: WordPressTarget = resolveWordPressTarget(),
): Promise<{ id: number; editUrl: string }> {
  logger.info('Creating WordPress post', { title, slug, status, publishDate, target: target.name });

  const htmlBody = markdownToHtml(body);

  const payload: WpPostPayload = {
    title,
    content: htmlBody,
    status,
    excerpt,
    ...(target.name === 'aiojisan' ? { featured_media: PLACEHOLDER_MEDIA_ID } : {}),
    ...(categories && categories.length > 0 ? { categories } : {}),
    ...(slug ? { slug } : {}),
    // Backdate the post (WordPress publishes a past-dated post at that date)
    ...(publishDate ? { date_gmt: new Date(publishDate).toISOString().slice(0, 19) } : {}),
  };

  const post = await wpFetch<WpPostResponse>('/posts', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, target);

  const editUrl = `${target.baseUrl}/wp-admin/post.php?post=${post.id}&action=edit`;

  logger.info('Post created', { id: post.id, status, editUrl, target: target.name });

  return { id: post.id, editUrl };
}

export async function getOrCreateWordPressCategory(
  name: string,
  slug: string,
  description?: string,
  target: WordPressTarget = resolveWordPressTarget(),
): Promise<number> {
  const existing = await wpFetch<WpCategoryResponse[]>(
    `/categories?slug=${encodeURIComponent(slug)}&per_page=1`,
    {},
    target,
  );

  if (existing[0]) {
    return existing[0].id;
  }

  const created = await wpFetch<WpCategoryResponse>('/categories', {
    method: 'POST',
    body: JSON.stringify({
      name,
      slug,
      ...(description ? { description } : {}),
    }),
  }, target);

  logger.info('WordPress category created', { id: created.id, name, slug, target: target.name });
  return created.id;
}

export async function updateWordPressDraft(
  postId: number,
  title: string,
  body: string,
  target: WordPressTarget = resolveWordPressTarget(),
): Promise<void> {
  logger.info('Updating WordPress draft', { postId, target: target.name });

  await wpFetch<WpPostResponse>(`/posts/${postId}`, {
    method: 'POST',
    body: JSON.stringify({ title, content: markdownToHtml(body) }),
  }, target);
}

// Flip an existing draft to published. Used by the compose dashboard so the
// user never has to log into WordPress (app-password REST bypasses 2FA).
export async function publishWordPressPost(
  postId: number,
  target: WordPressTarget = resolveWordPressTarget(),
): Promise<{ link: string }> {
  logger.info('Publishing WordPress post', { postId, target: target.name });

  const post = await wpFetch<WpPostResponse & { link: string }>(`/posts/${postId}`, {
    method: 'POST',
    body: JSON.stringify({ status: 'publish' }),
  }, target);

  return { link: post.link };
}

export async function testWordPressConnection(
  target: WordPressTarget = resolveWordPressTarget(),
): Promise<boolean> {
  try {
    await wpFetch<unknown>('/users/me', {}, target);
    return true;
  } catch (err) {
    logger.error('WordPress connection test failed', { err: String(err), target: target.name });
    return false;
  }
}

/**
 * Generate a featured image (pillar-routed provider with fallback) and
 * attach it to a WordPress post. Only called for auto-published articles.
 */
export async function generateAndAttachFeaturedImage(
  postId: number,
  title: string,
  summary: string,
  slug: string,
  pillar?: string,
  target: WordPressTarget = resolveWordPressTarget(),
): Promise<void> {
  logger.info('Generating featured image', { postId, slug, pillar, target: target.name });

  const imagePrompt =
    `テックブログのヘッダー画像を生成してください。` +
    `テーマ：「${title}」。` +
    `補足：${summary.slice(0, 150)}。` +
    `スタイル：明るい配色のフラットイラスト、白い背景、モダンなテクノロジーモチーフ。日本語テキスト使用可。顔なし、ロゴなし。`;

  const { buffer: imageBuffer, provider, model } = await generateFeaturedImageBuffer(
    imagePrompt,
    pillar,
  );
  logger.info('Image generated', { postId, provider, model });

  // Upload to WordPress media library
  const filename = `${slug}.png`;
  const mediaUrl = `${getApiBase(target)}/media`;

  const mediaRes = await fetch(mediaUrl, {
    method: 'POST',
    headers: {
      'Authorization': getAuthHeader(target),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Type': 'image/png',
    },
    body: new Uint8Array(imageBuffer),
  });

  if (!mediaRes.ok) {
    const body = await mediaRes.text();
    throw new Error(`WordPress media upload failed ${mediaRes.status}: ${body}`);
  }

  const media = await mediaRes.json() as WpMediaResponse;
  logger.info('Image uploaded to WordPress', { mediaId: media.id, url: media.source_url });

  // Attach media to post
  await wpFetch<WpPostResponse>(`/posts/${postId}`, {
    method: 'POST',
    body: JSON.stringify({ featured_media: media.id }),
  }, target);

  logger.info('Featured image attached', { postId, mediaId: media.id });
}

export interface PlaceholderPost {
  id: number;
  title: string;
  summary: string;
  slug: string;
}

interface WpListPost {
  id: number;
  slug: string;
  featured_media: number;
  title: { rendered: string };
  excerpt: { rendered: string };
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'); // keep last so it doesn't double-decode
}

function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

/**
 * List published posts that still have the placeholder featured image
 * (i.e. image generation never succeeded for them).
 */
export async function listPublishedPostsWithPlaceholderImage(): Promise<PlaceholderPost[]> {
  const result: PlaceholderPost[] = [];
  let page = 1;
  while (true) {
    let batch: WpListPost[];
    try {
      batch = await wpFetch<WpListPost[]>(
        `/posts?status=publish&per_page=100&_fields=id,slug,featured_media,title,excerpt&page=${page}`,
      );
    } catch (err) {
      const msg = String(err);
      // WordPress returns 400 rest_post_invalid_page_number when paging past the end
      if (msg.includes('invalid_page_number') || msg.includes('WordPress API error 400')) break;
      throw err;
    }
    if (batch.length === 0) break;
    for (const p of batch) {
      if (p.featured_media === PLACEHOLDER_MEDIA_ID) {
        result.push({
          id: p.id,
          title: stripHtml(p.title?.rendered ?? ''),
          summary: stripHtml(p.excerpt?.rendered ?? ''),
          slug: p.slug,
        });
      }
    }
    if (batch.length < 100) break;
    page++;
  }
  return result;
}
