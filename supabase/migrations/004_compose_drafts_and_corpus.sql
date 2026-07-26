-- ── 1. Multi-corpus support for the style RAG ────────────────────────────────
-- Existing rows are the AIおじさん corpus; new ichikarablog rows use 'ichikarablog'.
ALTER TABLE blog_style_chunks
  ADD COLUMN IF NOT EXISTS corpus TEXT NOT NULL DEFAULT 'aiojisan';

CREATE INDEX IF NOT EXISTS blog_style_chunks_corpus_idx
  ON blog_style_chunks (corpus);

-- Extend the vector search with an optional corpus filter.
-- p_corpus = NULL keeps the previous behaviour (search every corpus).
-- Adding a parameter creates an overload rather than replacing the 3-arg
-- function from 001, which would make existing 3-argument calls ambiguous.
DROP FUNCTION IF EXISTS match_blog_chunks(VECTOR(1536), FLOAT, INT);
CREATE OR REPLACE FUNCTION match_blog_chunks(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count     INT DEFAULT 10,
  p_corpus        TEXT DEFAULT NULL
)
RETURNS TABLE (
  id             UUID,
  chunk_text     TEXT,
  post_title     TEXT,
  topic_tags     TEXT[],
  tone_tag       TEXT,
  structure_type TEXT,
  style_tags     TEXT[],
  similarity     FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    bsc.id,
    bsc.chunk_text,
    bsc.post_title,
    bsc.topic_tags,
    bsc.tone_tag,
    bsc.structure_type,
    bsc.style_tags,
    1 - (bsc.embedding <=> query_embedding) AS similarity
  FROM blog_style_chunks bsc
  WHERE bsc.embedding IS NOT NULL
    AND (p_corpus IS NULL OR bsc.corpus = p_corpus)
    AND 1 - (bsc.embedding <=> query_embedding) > match_threshold
  ORDER BY bsc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ── 2. Composed drafts (topic-directed drafts for the personal blog) ─────────
CREATE TABLE IF NOT EXISTS composed_drafts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic        TEXT NOT NULL,
  angle        TEXT,
  title        TEXT NOT NULL,
  outline      TEXT,
  body         TEXT NOT NULL,
  source_urls  JSONB NOT NULL DEFAULT '[]'::jsonb,
  wp_target    TEXT NOT NULL,
  wp_post_id   INT,
  category     TEXT,
  status       TEXT NOT NULL DEFAULT 'draft',
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  CONSTRAINT composed_drafts_status_check
    CHECK (status IN ('draft', 'published', 'failed'))
);

CREATE INDEX IF NOT EXISTS composed_drafts_created_at_idx
  ON composed_drafts (created_at DESC);
