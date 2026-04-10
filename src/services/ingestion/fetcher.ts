// Article fetcher — RSS and HTML strategies
// Playwright support is a future extension point (see TODO below)

import Parser from 'rss-parser';
import iconv from 'iconv-lite';
import { createLogger } from '@/lib/logger';
import type { RawArticleCandidate, ExtractionConfig } from '@/types/ingestion';
import type { Source } from '@/types/database';

const logger = createLogger('fetcher');
const rssParser = new Parser();

const DEFAULT_HEADERS = {
  'User-Agent': 'AIojisan-bot/1.0 (+https://aiojisan.com)',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ja,en;q=0.5',
};

// ── RSS ───────────────────────────────────────────────────────────────────────

export async function fetchRssFeed(source: Source): Promise<RawArticleCandidate[]> {
  logger.info('Fetching RSS', { source: source.name, url: source.list_url });

  const feed = await rssParser.parseURL(source.list_url);

  return (feed.items ?? []).map(item => ({
    url: item.link ?? item.guid ?? '',
    title: item.title ?? undefined,
    publishedAt: item.isoDate ?? item.pubDate ?? undefined,
    excerpt: item.contentSnippet ?? undefined,
  })).filter(c => c.url);
}

// ── HTML list page ────────────────────────────────────────────────────────────

export async function fetchHtmlCandidates(source: Source): Promise<RawArticleCandidate[]> {
  logger.info('Fetching HTML list', { source: source.name, url: source.list_url });

  const html = await fetchPage(source.list_url);
  if (!html) return [];

  const config = source.extraction_config as ExtractionConfig & {
    linkSelector?: string;
    linkPattern?: string;
    externalLinksOnly?: boolean;
  };

  // Dynamically import to keep extractor modular
  const { default: { parse } } = await import('node-html-parser').then(m => ({ default: m }));
  const root = parse(html);

  const selector = config.linkSelector ?? 'a[href]';
  const baseUrl = new URL(source.base_url);

  const links = root.querySelectorAll(selector)
    .map(a => {
      const href = a.getAttribute('href') ?? '';
      try {
        return new URL(href, baseUrl).toString();
      } catch {
        return null;
      }
    })
    .filter((url): url is string => url !== null && url.startsWith('http'))
    .filter(url => {
      if (config.linkPattern) {
        return new RegExp(config.linkPattern).test(url);
      }
      const urlHostname = new URL(url).hostname;
      if (config.externalLinksOnly) {
        return urlHostname !== baseUrl.hostname;
      }
      return urlHostname === baseUrl.hostname;
    });

  // Deduplicate
  return [...new Set(links)].slice(0, 50).map(url => ({ url }));
}

// ── Playwright (future) ───────────────────────────────────────────────────────

export async function fetchPlaywrightCandidates(_source: Source): Promise<RawArticleCandidate[]> {
  // TODO: implement Playwright-based scraping when needed
  // Only use for sources that block simple fetch
  logger.warn('Playwright fetcher not yet implemented');
  return [];
}

// ── Article page fetch ────────────────────────────────────────────────────────

function detectCharset(contentType: string | null, htmlSnippet: string): string {
  // 1. HTTP Content-Type header
  if (contentType) {
    const m = contentType.match(/charset=([^\s;]+)/i);
    if (m) return m[1];
  }
  // 2. HTML <meta charset> or <meta http-equiv="Content-Type">
  const metaCharset = htmlSnippet.match(/<meta[^>]+charset=["']?([^"';\s>]+)/i);
  if (metaCharset) return metaCharset[1];
  const metaHttp = htmlSnippet.match(/http-equiv=["']?content-type["']?[^>]+content=["'][^"']*charset=([^"';\s>]+)/i);
  if (metaHttp) return metaHttp[1];
  return 'utf-8';
}

export async function fetchPage(url: string, retries = 2): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      const res = await fetch(url, {
        headers: DEFAULT_HEADERS,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        logger.warn('Fetch returned non-OK status', { url, status: res.status });
        return null;
      }

      const contentType = res.headers.get('content-type');
      const buffer = Buffer.from(await res.arrayBuffer());

      // Detect charset from HTTP header + first 1024 bytes of HTML
      const snippet = buffer.slice(0, 1024).toString('latin1');
      const charset = detectCharset(contentType, snippet);

      // Use iconv-lite for proper Japanese (Shift-JIS, EUC-JP) decoding
      if (iconv.encodingExists(charset)) {
        return iconv.decode(buffer, charset);
      }
      return buffer.toString('utf-8');

    } catch (err) {
      if (attempt === retries) {
        logger.error('Fetch failed', { url, err: String(err) });
        return null;
      }
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  return null;
}

// ── Dispatcher ───────────────────────────────────────────────────────────────

export async function fetchCandidates(source: Source): Promise<RawArticleCandidate[]> {
  switch (source.source_type) {
    case 'rss':        return fetchRssFeed(source);
    case 'html':       return fetchHtmlCandidates(source);
    case 'playwright': return fetchPlaywrightCandidates(source);
    default:
      logger.warn('Unknown source type', { type: source.source_type });
      return [];
  }
}
