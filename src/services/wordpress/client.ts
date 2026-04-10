// WordPress REST API client
// Uses Application Password auth — server-only

import { getEnv } from '@/lib/env';
import { createLogger } from '@/lib/logger';

const logger = createLogger('wordpress');

interface WpPostPayload {
  title: string;
  content: string;
  status: 'draft' | 'publish' | 'private';
  excerpt?: string;
  categories?: number[];
  tags?: number[];
  meta?: Record<string, unknown>;
}

interface WpPostResponse {
  id: number;
  link: string;
  status: string;
  title: { rendered: string };
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
): Promise<{ id: number; editUrl: string }> {
  logger.info('Creating WordPress draft', { title });

  const payload: WpPostPayload = {
    title,
    content: body,
    status: 'draft',
    excerpt,
  };

  const post = await wpFetch<WpPostResponse>('/posts', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  const env = getEnv();
  const editUrl = `${env.WORDPRESS_BASE_URL}/wp-admin/post.php?post=${post.id}&action=edit`;

  logger.info('Draft created', { id: post.id, editUrl });

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
