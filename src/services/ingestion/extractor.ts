// Article content extraction
// Cleans HTML and extracts structured article data

import { parse as parseHtml } from 'node-html-parser';
import { createHash } from 'node:crypto';
import { createLogger } from '@/lib/logger';
import type { ExtractedArticle, ExtractionConfig } from '@/types/ingestion';

const logger = createLogger('extractor');

// HTML elements to strip before text extraction
const REMOVE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe',
  'nav', 'header', 'footer', 'aside',
  '.ad', '.advertisement', '.share', '.social',
  '.related', '.sidebar', '.comments', '.widget',
  '[class*="share"]', '[class*="social"]', '[class*="ad-"]',
  '[id*="sidebar"]', '[id*="footer"]', '[id*="header"]',
];

export function cleanHtml(html: string, config?: ExtractionConfig): string {
  const root = parseHtml(html);

  // Remove noise elements
  const removeTargets = [...REMOVE_SELECTORS, ...(config?.excludeSelectors ?? [])];
  removeTargets.forEach(selector => {
    try {
      root.querySelectorAll(selector).forEach(el => el.remove());
    } catch {
      // Ignore invalid selectors
    }
  });

  return root.toString();
}

export function extractTitle(html: string, config?: ExtractionConfig): string {
  const root = parseHtml(html);

  if (config?.titleSelector) {
    const el = root.querySelector(config.titleSelector);
    if (el) return el.text.trim();
  }

  // Common title patterns
  for (const selector of ['h1', 'title', '[class*="title"]', '[class*="headline"]']) {
    const el = root.querySelector(selector);
    if (el?.text.trim()) return el.text.trim();
  }

  return '';
}

export function extractBodyText(html: string, config?: ExtractionConfig): string {
  const root = parseHtml(cleanHtml(html, config));

  if (config?.bodySelector) {
    const el = root.querySelector(config.bodySelector);
    if (el) return el.text.replace(/\s+/g, ' ').trim();
  }

  // Try common article body selectors
  for (const selector of [
    'article',
    '[class*="article-body"]',
    '[class*="post-body"]',
    '[class*="entry-content"]',
    '[class*="article-content"]',
    'main',
  ]) {
    const el = root.querySelector(selector);
    if (el) return el.text.replace(/\s+/g, ' ').trim();
  }

  // Fallback: body text
  return root.querySelector('body')?.text.replace(/\s+/g, ' ').trim() ?? '';
}

export function extractAuthor(html: string, config?: ExtractionConfig): string | null {
  const root = parseHtml(html);

  if (config?.authorSelector) {
    const el = root.querySelector(config.authorSelector);
    if (el) return el.text.trim();
  }

  for (const selector of [
    '[rel="author"]',
    '[class*="author"]',
    '[class*="byline"]',
    'meta[name="author"]',
  ]) {
    const el = root.querySelector(selector);
    const text = el?.getAttribute('content') ?? el?.text.trim();
    if (text) return text;
  }

  return null;
}

export function extractPublishedAt(html: string, config?: ExtractionConfig): string | null {
  const root = parseHtml(html);

  if (config?.dateSelector) {
    const el = root.querySelector(config.dateSelector);
    const date = el?.getAttribute('datetime') ?? el?.text.trim();
    if (date) return parseDate(date);
  }

  for (const selector of [
    'time[datetime]',
    'meta[property="article:published_time"]',
    'meta[name="publish_date"]',
    '[class*="publish"]',
    '[class*="date"]',
  ]) {
    const el = root.querySelector(selector);
    const date = el?.getAttribute('datetime')
      ?? el?.getAttribute('content')
      ?? el?.text.trim();
    if (date) return parseDate(date);
  }

  return null;
}

function parseDate(raw: string): string | null {
  try {
    const d = new Date(raw);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch {
    // ignore
  }
  return null;
}

export function extractMainImage(html: string): string | null {
  const root = parseHtml(html);

  // OG image is the most reliable
  const og = root.querySelector('meta[property="og:image"]');
  if (og?.getAttribute('content')) return og.getAttribute('content')!;

  const firstImg = root.querySelector('article img, main img');
  const src = firstImg?.getAttribute('src');
  return src ?? null;
}

export function extractCanonicalUrl(html: string, fallbackUrl: string): string {
  const root = parseHtml(html);
  const canonical = root.querySelector('link[rel="canonical"]');
  return canonical?.getAttribute('href') ?? fallbackUrl;
}

export function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 32);
}

export function detectLanguage(text: string): string {
  // Simple heuristic: check for Japanese characters
  const jaPattern = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF]/;
  return jaPattern.test(text) ? 'ja' : 'en';
}

export async function extractArticle(
  url: string,
  html: string,
  config?: ExtractionConfig,
): Promise<ExtractedArticle> {
  logger.debug('Extracting article', { url });

  const cleanedHtml = cleanHtml(html, config);
  const extractedText = extractBodyText(html, config);
  const title = extractTitle(html, config);
  const author = extractAuthor(html, config);
  const publishedAt = extractPublishedAt(html, config);
  const mainImageUrl = extractMainImage(html);
  const canonicalUrl = extractCanonicalUrl(html, url);
  const language = detectLanguage(extractedText);
  const hash = hashContent(extractedText.slice(0, 2000)); // Hash first 2000 chars

  return {
    originalUrl: url,
    canonicalUrl,
    title: title || url,
    author,
    publishedAt,
    rawHtml: html,
    extractedText,
    excerpt: extractedText.slice(0, 300),
    mainImageUrl,
    language,
    hash,
  };
}
