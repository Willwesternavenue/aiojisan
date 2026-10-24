// Main ingestion pipeline
// Orchestrates: fetch → extract → deduplicate → store

import { getAdminClient } from '@/lib/supabase/server';
import { getEnabledSources } from '@/lib/supabase/queries';
import { recordSourceFailureAlert, recordThinBodyAlert } from '@/services/alerts';
import { createLogger } from '@/lib/logger';
import { fetchCandidates, fetchPage } from './fetcher';
import { extractArticle, hashContent } from './extractor';
import { articleExistsByUrl, articleExistsByHash } from '@/lib/supabase/queries';
import type { Source } from '@/types/database';
import type { IngestionResult } from '@/types/ingestion';

// A real article body runs to thousands of characters; anything this short is
// a shell page, not content.
const MIN_BODY_CHARS = 400;
// Feed summaries are short by nature — enough to score on, not enough to be
// mistaken for a body.
const MIN_FEED_FALLBACK_CHARS = 60;

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

    // Counts pages that came back as a near-empty shell with no feed summary
    // to fall back on — the quiet failure mode this guards against.
    let thinBodyCount = 0;

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

        // A page that returns 200 but almost no text is the signature of a
        // JavaScript-rendered site: the server ships an empty shell and the
        // body is drawn in the browser. MIT Technology Review JP moved to one
        // and stopped delivering for a week without raising a single error —
        // every fetch "succeeded", and the identical shells were silently
        // dropped by the content-hash dedup.
        let extractedText = extracted.extractedText;
        let usedFeedFallback = false;

        if (extractedText.length < MIN_BODY_CHARS) {
          const feedText = (candidate.excerpt ?? '').trim();
          if (feedText.length >= MIN_FEED_FALLBACK_CHARS) {
            // The feed summary is far shorter than a real body, but it carries
            // the actual story, so scoring still works on it.
            extractedText = feedText;
            usedFeedFallback = true;
          } else {
            thinBodyCount++;
            logger.warn('Article body too short and no usable feed summary', {
              source: source.name,
              url: candidate.url,
              bodyChars: extracted.extractedText.length,
              feedChars: feedText.length,
            });
            continue;
          }
        }

        // Hash the text we are actually storing. The shell pages are byte
        // identical to each other, so hashing the fetched HTML would collapse
        // every article from a JS-rendered site onto one hash and silently
        // drop all but the first.
        const contentHash = usedFeedFallback ? hashContent(extractedText) : extracted.hash;

        // Dedup check by content hash
        const hashExists = await articleExistsByHash(contentHash);
        if (hashExists) continue;

        // Insert into articles table
        const { error: insertError } = await db.from('articles').insert({
          source_id: source.id,
          original_url: extracted.originalUrl,
          canonical_url: extracted.canonicalUrl,
          // The shell page carries only the site name in <title>, so the feed's
          // own title is the only real one when we fall back.
          title: usedFeedFallback && candidate.title ? candidate.title : extracted.title,
          author: extracted.author,
          published_at: extracted.publishedAt ?? candidate.publishedAt ?? null,
          raw_html: extracted.rawHtml,
          extracted_text: extractedText,
          excerpt: extracted.excerpt,
          main_image_url: extracted.mainImageUrl,
          language: extracted.language,
          hash: contentHash,
        });

        if (insertError) {
          // Likely a race condition on unique constraint — skip
          if (insertError.code === '23505') continue;
          logger.warn('Insert error', { url: candidate.url, error: insertError.message });
          result.errors.push(`${candidate.url}: ${insertError.message}`);
          continue;
        }

        result.itemsInserted++;
        logger.debug('Article inserted', {
          url: extracted.canonicalUrl,
          feedFallback: usedFeedFallback,
        });

      } catch (err) {
        const msg = String(err);
        result.errors.push(`${candidate.url}: ${msg}`);
        logger.warn('Candidate error', { url: candidate.url, err: msg });
      }
    }

    // Every candidate came back as an empty shell: the source is effectively
    // dead even though not one request failed.
    if (thinBodyCount > 0 && thinBodyCount === result.itemsFound) {
      await recordThinBodyAlert(source.name, thinBodyCount, result.itemsFound);
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
    await recordSourceFailureAlert(source.name, msg);

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
