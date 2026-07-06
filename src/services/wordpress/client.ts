// WordPress REST API client
// Uses Application Password auth — server-only

import { marked } from 'marked';
import { getEnv, getGoogleAiKey } from '@/lib/env';
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

// Featured-image model: Google gemini-2.5-flash-image (Nano Banana) — strong flat
// illustrations at ~$0.039/image. We generate a TEXT-FREE decorative image: any
// Japanese baked into the image garbles, so the title is shown by the site instead.
const IMAGE_MODEL = 'gemini-2.5-flash-image';
const GEMINI_IMAGE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`;

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

function getAuthHeader(): string {
  const env = getEnv();
  const credentials = `${env.WORDPRESS_USERNAME}:${env.WORDPRESS_APP_PASSWORD}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

function getApiBase(): string {
  const env = getEnv();
  return `${env.WORDPRESS_BASE_URL.replace(/\/$/, '')}/wp-json/wp/v2`;
}

async function wpFetch<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const url = `${getApiBase()}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': getAuthHeader(),
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WordPress API error ${res.status}: ${body}`);
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
): Promise<{ id: number; editUrl: string }> {
  logger.info('Creating WordPress post', { title, slug, status, publishDate });

  const htmlBody = markdownToHtml(body);

  const payload: WpPostPayload = {
    title,
    content: htmlBody,
    status,
    excerpt,
    featured_media: PLACEHOLDER_MEDIA_ID,
    ...(categories && categories.length > 0 ? { categories } : {}),
    ...(slug ? { slug } : {}),
    // Backdate the post (WordPress publishes a past-dated post at that date)
    ...(publishDate ? { date_gmt: new Date(publishDate).toISOString().slice(0, 19) } : {}),
  };

  const post = await wpFetch<WpPostResponse>('/posts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const env = getEnv();
  const editUrl = `${env.WORDPRESS_BASE_URL}/wp-admin/post.php?post=${post.id}&action=edit`;

  logger.info('Post created', { id: post.id, status, editUrl });

  return { id: post.id, editUrl };
}

export async function getOrCreateWordPressCategory(
  name: string,
  slug: string,
  description?: string,
): Promise<number> {
  const existing = await wpFetch<WpCategoryResponse[]>(
    `/categories?slug=${encodeURIComponent(slug)}&per_page=1`,
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
  });

  logger.info('WordPress category created', { id: created.id, name, slug });
  return created.id;
}

export async function updateWordPressDraft(
  postId: number,
  title: string,
  body: string,
): Promise<void> {
  logger.info('Updating WordPress draft', { postId });

  await wpFetch<WpPostResponse>(`/posts/${postId}`, {
    method: 'POST',
    body: JSON.stringify({ title, content: markdownToHtml(body) }),
  });
}

export async function testWordPressConnection(): Promise<boolean> {
  try {
    await wpFetch<unknown>('/users/me');
    return true;
  } catch (err) {
    logger.error('WordPress connection test failed', { err: String(err) });
    return false;
  }
}

/**
 * Generate a featured image with DALL-E 3 and attach it to a WordPress post.
 * Only called for auto-published articles to keep costs low.
 */
export async function generateAndAttachFeaturedImage(
  postId: number,
  title: string,
  summary: string,
  slug: string,
): Promise<void> {
  logger.info('Generating featured image', { postId, slug });

  // 記事テーマは「理解のためだけ」に渡し、画像内には文字を一切描かせない。
  // 日本語テキストはどの画像モデルでも文字化けし、タイトルを焼き込むと固有名詞も漏れるため、
  // 装飾イラストのみ生成する（タイトルはサイト側の本物テキストで表示される）。
  const imagePrompt =
    'Create a clean, modern FLAT VECTOR ILLUSTRATION for a tech blog header (decorative eyecatch). ' +
    'Use the following Japanese article ONLY to understand the THEME (do NOT render any of its words): ' +
    `TITLE=「${title}」 SUMMARY=「${summary.slice(0, 200)}」. ` +
    'Depict the theme with abstract tech motifs (cloud, server racks, circuit traces, gears, connection nodes, a subtle pause or warning symbol when relevant). ' +
    'Bright friendly palette: blue base with orange accents, white background, balanced centered composition with clean negative space, minimalist and premium. ' +
    'STRICT: absolutely NO text, NO letters, NO words, NO numbers, NO brand names, NO logos, NO captions, no human faces. Wide 16:9.';

  const genRes = await fetch(`${GEMINI_IMAGE_ENDPOINT}?key=${getGoogleAiKey()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: imagePrompt }] }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        imageConfig: { aspectRatio: '16:9' },
      },
    }),
  });

  if (!genRes.ok) {
    const body = await genRes.text();
    throw new Error(`Gemini image generation failed ${genRes.status}: ${body}`);
  }

  const genJson = (await genRes.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
  };
  const parts = genJson.candidates?.[0]?.content?.parts ?? [];
  const b64 = parts.find((p) => p.inlineData?.data)?.inlineData?.data;
  if (!b64) throw new Error(`${IMAGE_MODEL} returned no image data`);

  const imageBuffer = Buffer.from(b64, 'base64');

  // Upload to WordPress media library
  const filename = `${slug}.png`;
  const mediaUrl = `${getApiBase()}/media`;

  const mediaRes = await fetch(mediaUrl, {
    method: 'POST',
    headers: {
      'Authorization': getAuthHeader(),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Type': 'image/png',
    },
    body: imageBuffer,
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
  });

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
