// RAG retrieval — find relevant style chunks for draft generation

import { getAdminClient } from '@/lib/supabase/server';
import { getAiProvider } from '@/services/ai';
import { createLogger } from '@/lib/logger';

const logger = createLogger('rag-retrieval');

export interface RetrievedChunk {
  id: string;
  chunkText: string;
  postTitle: string;
  topicTags: string[];
  toneTag: string | null;
  structureType: string | null;
  styleTags: string[];
  similarity: number;
}

// ── Vector similarity retrieval ───────────────────────────────────────────────

export async function retrieveStyleChunks(
  queryText: string,
  options: {
    matchThreshold?: number;
    matchCount?: number;
    corpus?: string;
  } = {},
): Promise<RetrievedChunk[]> {
  const { matchThreshold = 0.65, matchCount = 8, corpus } = options;

  logger.info('Retrieving style chunks', { queryLength: queryText.length, corpus: corpus ?? '(all)' });

  const ai = getAiProvider();
  const embedding = await ai.generateEmbedding(queryText);

  const db = getAdminClient();
  const { data, error } = await db.rpc('match_blog_chunks', {
    query_embedding: embedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
    p_corpus: corpus ?? null,
  });

  if (error) {
    logger.error('Vector retrieval failed', { error: error.message });
    return [];
  }

  return (data ?? []).map((row: {
    id: string;
    chunk_text: string;
    post_title: string;
    topic_tags: string[];
    tone_tag: string | null;
    structure_type: string | null;
    style_tags: string[];
    similarity: number;
  }) => ({
    id: row.id,
    chunkText: row.chunk_text,
    postTitle: row.post_title,
    topicTags: row.topic_tags,
    toneTag: row.tone_tag,
    structureType: row.structure_type,
    styleTags: row.style_tags,
    similarity: row.similarity,
  }));
}

// ── Prepare chunks for prompt injection ──────────────────────────────────────

export async function getStyleChunksForDraft(
  articleTitle: string,
  topics: string[],
  // Default to the AIおじさん corpus so existing 2-argument callers (the news
  // pipeline) never pull personal-blog style samples. Pass 'ichikarablog'
  // explicitly (as the compose path does) to opt into that corpus instead.
  corpus: string = 'aiojisan',
): Promise<string[]> {
  const query = `${articleTitle} ${topics.join(' ')}`;

  const chunks = await retrieveStyleChunks(query, {
    // 0.60 was set before either corpus had data and turned out to sit above
    // what this embedding model actually produces for Japanese prose: measured
    // over both corpora, top-5 similarity for a clearly on-topic query lands
    // between 0.44 and 0.67, so 0.60 returned nothing on most queries and the
    // style RAG silently never fired. 0.45 reliably returns on-topic samples
    // while still excluding unrelated ones.
    matchThreshold: 0.45,
    matchCount: 5,
    corpus,
  });

  if (chunks.length === 0) {
    logger.info('No style chunks found for draft', { corpus });
    return [];
  }

  // Return just the text for prompt injection
  return chunks.map(c => c.chunkText);
}
