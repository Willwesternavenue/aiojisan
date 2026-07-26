// Past blog post ingestion pipeline for RAG
// Run this once (or periodically) to populate blog_style_chunks

import { getAdminClient } from '@/lib/supabase/server';
import { getAiProvider } from '@/services/ai';
import { createLogger } from '@/lib/logger';
import { chunkPostContent } from './chunker';
import { extractChunkMetadata } from './metadata';
import { cleanHtml } from '@/services/ingestion/extractor';

const logger = createLogger('rag-ingest');

export interface RawBlogPost {
  id: string;
  title: string;
  url: string;
  published_at: string | null;
  category?: string;
  tags?: string[];
  content: string;  // HTML or markdown
  excerpt?: string;
}

export async function ingestBlogPost(post: RawBlogPost, corpus = 'aiojisan'): Promise<number> {
  const db = getAdminClient();
  const ai = getAiProvider();

  logger.info('Ingesting post', { id: post.id, title: post.title });

  // Clean HTML content to plain text
  const cleanText = cleanHtml(post.content)
    .replace(/<[^>]+>/g, ' ')   // Strip remaining tags
    .replace(/\s+/g, ' ')        // Normalize whitespace
    .trim();

  // Chunk the post
  const chunks = chunkPostContent(cleanText);
  logger.info('Chunks created', { postId: post.id, count: chunks.length });

  let inserted = 0;

  for (const chunk of chunks) {
    // Check if already exists
    const { count } = await db
      .from('blog_style_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('source_post_id', post.id)
      .eq('chunk_index', chunk.index)
      .eq('corpus', corpus);

    if ((count ?? 0) > 0) continue;

    // Extract metadata
    const metadata = await extractChunkMetadata(chunk.text);

    // Generate embedding
    const embedding = await ai.generateEmbedding(chunk.text);

    // Store chunk
    const { error } = await db.from('blog_style_chunks').insert({
      source_post_id: post.id,
      post_title: post.title,
      post_url: post.url,
      published_at: post.published_at,
      category: post.category ?? null,
      tags: post.tags ?? [],
      section_title: chunk.sectionTitle,
      chunk_index: chunk.index,
      chunk_text: chunk.text,
      topic_tags: metadata.topicTags,
      tone_tag: metadata.toneTag || null,
      structure_type: metadata.structureType || null,
      style_tags: metadata.styleTags,
      corpus,
      embedding,
    });

    if (error) {
      logger.warn('Chunk insert failed', {
        postId: post.id,
        chunkIndex: chunk.index,
        error: error.message,
      });
    } else {
      inserted++;
    }
  }

  logger.info('Post ingestion complete', { postId: post.id, inserted });
  return inserted;
}

export async function ingestBlogPosts(posts: RawBlogPost[], corpus = 'aiojisan'): Promise<number> {
  let totalInserted = 0;

  for (const post of posts) {
    const count = await ingestBlogPost(post, corpus);
    totalInserted += count;
    // Brief pause to respect rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  logger.info('Batch ingestion complete', {
    posts: posts.length,
    totalChunks: totalInserted,
    corpus,
  });

  return totalInserted;
}
