-- Default match_blog_chunks' p_corpus filter to 'aiojisan'.
--
-- Migration 004 added p_corpus with DEFAULT NULL ("search every corpus").
-- Any caller that invokes match_blog_chunks with only 3 arguments — which
-- includes the currently deployed production code (it predates the p_corpus
-- parameter and never passes it) — therefore searches every corpus,
-- including the ichikarablog corpus being bulk-imported right now. That lets
-- personal-blog style samples leak into the AIおじさん news pipeline's
-- drafts with no signal in the logs. Flipping the default to 'aiojisan'
-- makes 3-argument calls search the AIおじさん corpus only, matching the
-- intended default. Callers that want every corpus (or the ichikarablog
-- corpus) keep working exactly as before by passing p_corpus explicitly
-- (NULL or 'ichikarablog').
--
-- This changes only the DEFAULT of an existing parameter — the function's
-- name, argument order, and argument types (its identity in Postgres) are
-- unchanged, and the body's semantics are unchanged (p_corpus IS NULL still
-- means "search all corpora" when explicitly passed as NULL). CREATE OR
-- REPLACE is therefore sufficient; a DROP is unnecessary and is deliberately
-- not used here.
CREATE OR REPLACE FUNCTION match_blog_chunks(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count     INT DEFAULT 10,
  p_corpus        TEXT DEFAULT 'aiojisan'
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
