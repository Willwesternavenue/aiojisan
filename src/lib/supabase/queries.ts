// Reusable query helpers — server-side only
// All functions use the admin client

import { getAdminClient } from './server';
import type { Source, Article, ArticleWithInsights, GeneratedDraft } from '@/types';

// ── Sources ──────────────────────────────────────────────────────────────────

export async function getEnabledSources() {
  const db = getAdminClient();
  const { data, error } = await db
    .from('sources')
    .select('*')
    .eq('enabled', true)
    .order('priority', { ascending: false });

  if (error) throw new Error(`getEnabledSources: ${error.message}`);
  return data as Source[];
}

export async function getAllSources() {
  const db = getAdminClient();
  const { data, error } = await db
    .from('sources')
    .select('*')
    .order('priority', { ascending: false });

  if (error) throw new Error(`getAllSources: ${error.message}`);
  return data as Source[];
}

export async function getSourceById(id: string) {
  const db = getAdminClient();
  const { data, error } = await db
    .from('sources')
    .select('*')
    .eq('id', id)
    .single();

  if (error) throw new Error(`getSourceById: ${error.message}`);
  return data as Source;
}

// ── Articles ─────────────────────────────────────────────────────────────────

export async function getUnprocessedArticles(limit = 50) {
  const db = getAdminClient();
  // Articles with no AI insights yet
  const { data, error } = await db
    .from('articles')
    .select('*, sources(name, source_type)')
    .is('article_ai_insights', null)
    .order('fetched_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getUnprocessedArticles: ${error.message}`);
  return data;
}

const ARTICLE_FEED_SELECT_LEFT = `
  *,
  sources(name, source_type),
  article_ai_insights(*),
  article_actions(action_type)
`;

const ARTICLE_FEED_SELECT_INNER = `
  *,
  sources(name, source_type),
  article_ai_insights!inner(*),
  article_actions(action_type)
`;

export async function getArticlesFeed(options: {
  limit?: number;
  offset?: number;
  sourceId?: string;
  sortBy?: 'newest' | 'score' | 'blog' | 'x';
  minScore?: number;
  favorites?: boolean;
  excluded?: boolean;
  drafted?: boolean;
} = {}) {
  const db = getAdminClient();
  const { limit = 50, offset = 0, sortBy = 'newest' } = options;

  // 新着順: 従来どおり fetched_at
  if (sortBy === 'newest') {
    let query = db
      .from('articles')
      .select(ARTICLE_FEED_SELECT_LEFT)
      .order('fetched_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (options.sourceId) {
      query = query.eq('source_id', options.sourceId);
    }

    const { data, error } = await query;
    if (error) throw new Error(`getArticlesFeed: ${error.message}`);
    return data as ArticleWithInsights[];
  }

  // スコア系: DB 上で「insights あり」を先頭（スコア降順）、その後「未処理」を新着順。
  // 直近 N 件だけ取ってクライアントソートすると、未処理ばかりでスコアが全部空に見えるのを防ぐ。
  const scoreColumn =
    sortBy === 'score'
      ? 'overall_score'
      : sortBy === 'blog'
        ? 'blog_post_potential_score'
        : 'x_post_potential_score';

  let countQuery = db
    .from('articles')
    .select('id, article_ai_insights!inner(article_id)', { count: 'exact', head: true });
  if (options.sourceId) {
    countQuery = countQuery.eq('source_id', options.sourceId);
  }
  const { count: processedTotal, error: countError } = await countQuery;
  if (countError) throw new Error(`getArticlesFeed: ${countError.message}`);
  const processedCount = processedTotal ?? 0;

  const fetchProcessedRange = async (from: number, to: number) => {
    if (from > to) return [] as ArticleWithInsights[];
    let q = db
      .from('articles')
      .select(ARTICLE_FEED_SELECT_INNER)
      .order(scoreColumn, { ascending: false, foreignTable: 'article_ai_insights' })
      .order('fetched_at', { ascending: false })
      .range(from, to);
    if (options.sourceId) {
      q = q.eq('source_id', options.sourceId);
    }
    const { data, error } = await q;
    if (error) throw new Error(`getArticlesFeed: ${error.message}`);
    return (data ?? []) as ArticleWithInsights[];
  };

  const fetchUnprocessedRange = async (from: number, to: number) => {
    if (from > to) return [] as ArticleWithInsights[];
    let q = db
      .from('articles')
      .select(ARTICLE_FEED_SELECT_LEFT)
      .is('article_ai_insights', null)
      .order('fetched_at', { ascending: false })
      .range(from, to);
    if (options.sourceId) {
      q = q.eq('source_id', options.sourceId);
    }
    const { data, error } = await q;
    if (error) throw new Error(`getArticlesFeed: ${error.message}`);
    return (data ?? []) as ArticleWithInsights[];
  };

  const end = offset + limit - 1;

  if (end < processedCount) {
    return fetchProcessedRange(offset, end);
  }

  if (offset >= processedCount) {
    return fetchUnprocessedRange(offset - processedCount, end - processedCount);
  }

  const fromProcessed = offset;
  const toProcessed = processedCount - 1;
  const processedRows = await fetchProcessedRange(fromProcessed, toProcessed);
  const need = limit - processedRows.length;
  const unprocessedRows =
    need > 0 ? await fetchUnprocessedRange(0, need - 1) : [];

  return [...processedRows, ...unprocessedRows];
}

export async function getArticleById(id: string) {
  const db = getAdminClient();
  const { data, error } = await db
    .from('articles')
    .select(`
      *,
      sources(name, source_type),
      article_ai_insights(*),
      article_actions(*)
    `)
    .eq('id', id)
    .single();

  if (error) throw new Error(`getArticleById: ${error.message}`);
  return data as ArticleWithInsights;
}

export async function articleExistsByUrl(canonicalUrl: string): Promise<boolean> {
  const db = getAdminClient();
  const { count, error } = await db
    .from('articles')
    .select('id', { count: 'exact', head: true })
    .eq('canonical_url', canonicalUrl);

  if (error) throw new Error(`articleExistsByUrl: ${error.message}`);
  return (count ?? 0) > 0;
}

export async function articleExistsByHash(hash: string): Promise<boolean> {
  const db = getAdminClient();
  const { count, error } = await db
    .from('articles')
    .select('id', { count: 'exact', head: true })
    .eq('hash', hash);

  if (error) throw new Error(`articleExistsByHash: ${error.message}`);
  return (count ?? 0) > 0;
}

// ── Drafts ───────────────────────────────────────────────────────────────────

export async function getRecentDrafts(limit = 20) {
  const db = getAdminClient();
  const { data, error } = await db
    .from('generated_drafts')
    .select('*, articles(title, canonical_url)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(`getRecentDrafts: ${error.message}`);
  return data as (GeneratedDraft & { articles: Pick<Article, 'title' | 'canonical_url'> })[];
}

// ── Dashboard stats ──────────────────────────────────────────────────────────

export async function getDashboardStats() {
  const db = getAdminClient();

  const [sourcesRes, newArticlesRes, highScoreRes, draftsRes] = await Promise.all([
    db.from('sources').select('id', { count: 'exact', head: true }).eq('enabled', true),
    db.from('articles').select('id', { count: 'exact', head: true })
      .gte('fetched_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
    db.from('article_ai_insights').select('id', { count: 'exact', head: true })
      .gte('overall_score', 7),
    db.from('generated_drafts').select('id', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()),
  ]);

  return {
    enabledSources: sourcesRes.count ?? 0,
    newArticlesToday: newArticlesRes.count ?? 0,
    highScoreItems: highScoreRes.count ?? 0,
    draftsThisWeek: draftsRes.count ?? 0,
  };
}
