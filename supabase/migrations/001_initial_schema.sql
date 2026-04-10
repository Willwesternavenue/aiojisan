-- AI Oji-san Blog System — Initial Schema
-- Run via: supabase db push  OR  paste into Supabase SQL editor

-- Enable pgvector for RAG embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- ── sources ──────────────────────────────────────────────────────────────────
CREATE TABLE sources (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  source_type     TEXT NOT NULL CHECK (source_type IN ('rss', 'html', 'playwright')),
  base_url        TEXT NOT NULL,
  list_url        TEXT NOT NULL,
  extraction_config JSONB NOT NULL DEFAULT '{}',
  enabled         BOOLEAN NOT NULL DEFAULT TRUE,
  priority        INTEGER NOT NULL DEFAULT 5,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── source_runs ──────────────────────────────────────────────────────────────
CREATE TABLE source_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  run_type        TEXT NOT NULL DEFAULT 'scheduled',
  status          TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  items_found     INTEGER NOT NULL DEFAULT 0,
  items_inserted  INTEGER NOT NULL DEFAULT 0,
  error_message   TEXT
);

CREATE INDEX idx_source_runs_source_id ON source_runs(source_id);
CREATE INDEX idx_source_runs_started_at ON source_runs(started_at DESC);

-- ── articles ─────────────────────────────────────────────────────────────────
CREATE TABLE articles (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id       UUID NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  original_url    TEXT NOT NULL,
  canonical_url   TEXT NOT NULL,
  title           TEXT NOT NULL,
  author          TEXT,
  published_at    TIMESTAMPTZ,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  raw_html        TEXT,
  extracted_text  TEXT,
  excerpt         TEXT,
  main_image_url  TEXT,
  language        TEXT NOT NULL DEFAULT 'ja',
  hash            TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_articles_canonical_url UNIQUE (canonical_url),
  CONSTRAINT uq_articles_hash UNIQUE (hash)
);

CREATE INDEX idx_articles_source_id ON articles(source_id);
CREATE INDEX idx_articles_published_at ON articles(published_at DESC);
CREATE INDEX idx_articles_fetched_at ON articles(fetched_at DESC);

-- ── article_ai_insights ──────────────────────────────────────────────────────
CREATE TABLE article_ai_insights (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id                UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  short_summary             TEXT,
  long_summary              TEXT,
  tags                      TEXT[] NOT NULL DEFAULT '{}',
  topics                    TEXT[] NOT NULL DEFAULT '{}',
  ai_ojisan_fit_score       NUMERIC(4,2),
  x_post_potential_score    NUMERIC(4,2),
  blog_post_potential_score NUMERIC(4,2),
  novelty_score             NUMERIC(4,2),
  source_reliability_score  NUMERIC(4,2),
  overall_score             NUMERIC(4,2),
  reasoning                 TEXT,
  generated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_ai_insights_article UNIQUE (article_id)
);

CREATE INDEX idx_ai_insights_overall_score ON article_ai_insights(overall_score DESC);
CREATE INDEX idx_ai_insights_blog_score ON article_ai_insights(blog_post_potential_score DESC);
CREATE INDEX idx_ai_insights_x_score ON article_ai_insights(x_post_potential_score DESC);

-- ── article_actions ──────────────────────────────────────────────────────────
CREATE TABLE article_actions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id   UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  action_type  TEXT NOT NULL CHECK (action_type IN (
    'favorite', 'exclude', 'hold', 'mark_reviewed',
    'generate_blog_draft', 'generate_x_post', 'publish_to_wordpress'
  )),
  action_value TEXT,
  note         TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_article_actions_article_id ON article_actions(article_id);
CREATE INDEX idx_article_actions_type ON article_actions(action_type);

-- ── generated_drafts ─────────────────────────────────────────────────────────
CREATE TABLE generated_drafts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id          UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  draft_title         TEXT NOT NULL,
  draft_outline       TEXT,
  draft_body          TEXT NOT NULL,
  wordpress_post_id   INTEGER,
  status              TEXT NOT NULL DEFAULT 'generated'
                      CHECK (status IN ('generated', 'sent_to_wordpress', 'published')),
  generation_metadata JSONB NOT NULL DEFAULT '{}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_generated_drafts_article_id ON generated_drafts(article_id);
CREATE INDEX idx_generated_drafts_status ON generated_drafts(status);
CREATE INDEX idx_generated_drafts_created_at ON generated_drafts(created_at DESC);

-- ── generated_x_posts ────────────────────────────────────────────────────────
CREATE TABLE generated_x_posts (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  article_id     UUID NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  variant_label  TEXT NOT NULL CHECK (variant_label IN ('direct', 'analytical', 'opinion')),
  text           TEXT NOT NULL,
  tone           TEXT NOT NULL DEFAULT '',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_generated_x_posts_article_id ON generated_x_posts(article_id);

-- ── blog_style_chunks ─────────────────────────────────────────────────────────
CREATE TABLE blog_style_chunks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_post_id  TEXT NOT NULL,
  post_title      TEXT NOT NULL,
  post_url        TEXT NOT NULL,
  published_at    TIMESTAMPTZ,
  category        TEXT,
  tags            TEXT[] NOT NULL DEFAULT '{}',
  section_title   TEXT,
  chunk_index     INTEGER NOT NULL,
  chunk_text      TEXT NOT NULL,
  topic_tags      TEXT[] NOT NULL DEFAULT '{}',
  tone_tag        TEXT,
  structure_type  TEXT,
  style_tags      TEXT[] NOT NULL DEFAULT '{}',
  embedding       VECTOR(1536),  -- OpenAI text-embedding-3-small dimension
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_blog_chunk UNIQUE (source_post_id, chunk_index)
);

CREATE INDEX idx_blog_style_chunks_source_post ON blog_style_chunks(source_post_id);
-- Vector similarity search index (IVFFlat — create after loading data)
-- CREATE INDEX idx_blog_style_chunks_embedding ON blog_style_chunks
--   USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── updated_at trigger ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sources_updated_at
  BEFORE UPDATE ON sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_articles_updated_at
  BEFORE UPDATE ON articles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_generated_drafts_updated_at
  BEFORE UPDATE ON generated_drafts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_blog_style_chunks_updated_at
  BEFORE UPDATE ON blog_style_chunks
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ── match_blog_chunks function (RAG vector search) ────────────────────────────
CREATE OR REPLACE FUNCTION match_blog_chunks(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count     INT DEFAULT 10
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
    AND 1 - (bsc.embedding <=> query_embedding) > match_threshold
  ORDER BY bsc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
