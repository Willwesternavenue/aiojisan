// Main ingestion pipeline
// Orchestrates: fetch → extract → deduplicate → store

import { getAdminClient } from '@/lib/supabase/server';
import { getEnabledSources } from '@/lib/supabase/queries';
import { createLogger } from '@/lib/logger';
import { fetchCandidates, fetchPage } from './fetcher';
import { extractArticle } from './extractor';
import { articleExistsByUrl, articleExistsByHash } from '@/lib/supabase/queries';
import type { Source } from '@/types/database';
import type { IngestionResult } from '@/types/ingestion';

const logger = createLogger('pipeline');

// ── Single source run ─────────────────────────────────────────────────────────

export async function runSourceIngestion(source: Source): Promise<IngestionResult> {
  const db = getAdminClient();
  const result: IngestionResult = {
    sourceId: source.id,
    itemsFound: 0,
    itemsInserted: 0,
    errors: [],
  };

  // Record run start
  const { data: run } = await db
    .from('source_runs')
    .insert({
      source_id: source.id,
      run_type: 'scheduled',
      status: 'running',
    })
    .select('id')
    .single();

  const runId = run?.id;

  try {
    // 1. Fetch candidates
    const candidates = await fetchCandidates(source);
    result.itemsFound = candidates.length;
    logger.info('Candidates fetched', { source: source.name, count: candidates.length });

    // 2. Process each candidate
    const config = source.extraction_config as Record<string, unknown>;

    for (const candidate of candidates) {
      if (!candidate.url) continue;

      try {
        // Dedup check by URL before fetching full page
        const urlExists = await articleExistsByUrl(candidate.url);
        if (urlExists) continue;

        // Fetch article page
        const html = await fetchPage(candidate.url);
        if (!html) continue;

        // Extract structured data
        const extracted = await extractArticle(candidate.url, html, config as any);

        // Dedup check by content hash
        const hashExists = await articleExistsByHash(extracted.hash);
        if (hashExists) continue;

        // Insert into articles table
        const { error: insertError } = await db.from('articles').insert({
          source_id: source.id,
          original_url: extracted.originalUrl,
          canonical_url: extracted.canonicalUrl,
          title: extracted.title,
          author: extracted.author,
          published_at: extracted.publishedAt,
          raw_html: extracted.rawHtml,
          extracted_text: extracted.extractedText,
          excerpt: extracted.excerpt,
          main_image_url: extracted.mainImageUrl,
          language: extracted.language,
          hash: extracted.hash,
        });

        if (insertError) {
          // Likely a race condition on unique constraint — skip
          if (insertError.code === '23505') continue;
          logger.warn('Insert error', { url: candidate.url, error: insertError.message });
          result.errors.push(`${candidate.url}: ${insertError.message}`);
          continue;
        }

        result.itemsInserted++;
        logger.debug('Article inserted', { url: extracted.canonicalUrl });

      } catch (err) {
        const msg = String(err);
        result.errors.push(`${candidate.url}: ${msg}`);
        logger.warn('Candidate error', { url: candidate.url, err: msg });
      }
    }

    // Mark run complete
    if (runId) {
      await db.from('source_runs').update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        items_found: result.itemsFound,
        items_inserted: result.itemsInserted,
      }).eq('id', runId);
    }

    logger.info('Source run complete', {
      source: source.name,
      found: result.itemsFound,
      inserted: result.itemsInserted,
    });

  } catch (err) {
    const msg = String(err);
    logger.error('Source run failed', { source: source.name, err: msg });
    result.errors.push(msg);

    if (runId) {
      await db.from('source_runs').update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: msg,
      }).eq('id', runId);
    }
  }

  return result;
}

// ── All enabled sources ───────────────────────────────────────────────────────

export async function runAllEnabledSources(): Promise<IngestionResult[]> {
  const sources = await getEnabledSources();
  logger.info('Running ingestion for all sources', { count: sources.length });

  // Run sources sequentially to avoid hammering targets
  const results: IngestionResult[] = [];
  for (const source of sources) {
    const result = await runSourceIngestion(source);
    results.push(result);
  }

  return results;
}
