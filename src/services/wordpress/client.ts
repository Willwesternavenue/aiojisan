// WordPress REST API client
// Uses Application Password auth — server-only

import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { marked } from 'marked';
import { getEnv, getOpenAiKey, getGoogleAiKey } from '@/lib/env';
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
): Promise<{ id: number; editUrl: string }> {
  logger.info('Creating WordPress post', { title, slug, status });

  const htmlBody = markdownToHtml(body);

  const payload: WpPostPayload = {
    title,
    content: htmlBody,
    status,
    excerpt,
    featured_media: PLACEHOLDER_MEDIA_ID,
    ...(slug ? { slug } : {}),
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

export async function updateWordPressDraft(
  postId: number,
  title: string,
  body: string,
): Promise<void> {
  logger.info('Updating WordPress draft', { postId });

  await wpFetch<WpPostResponse>(`/posts/${postId}`, {
    method: 'POST',
    body: JSON.stringify({ title, content: body }),
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

  const ai = new GoogleGenAI({ apiKey: getGoogleAiKey() });

  const imagePrompt =
    `テックブログのヘッダー画像を生成してください。` +
    `テーマ：「${title}」。` +
    `補足：${summary.slice(0, 150)}。` +
    `スタイル：明るい配色のフラットイラスト、白い背景、モダンなテクノロジーモチーフ。日本語テキスト使用可。顔なし、ロゴなし。`;

  const imageResponse = await ai.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: imagePrompt,
    config: { responseModalities: ['IMAGE', 'TEXT'] },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = (imageResponse as any).candidates?.[0]?.content?.parts ?? [];
  const imgPart = parts.find((p: any) => p.inlineData);
  if (!imgPart?.inlineData?.data) throw new Error('gemini-3-pro-image-preview returned no image data');

  const imageBuffer = Buffer.from(imgPart.inlineData.data, 'base64');

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
