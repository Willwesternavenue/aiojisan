// Database types — mirrors Supabase schema
// Keep in sync with supabase/migrations/001_initial_schema.sql

export type SourceType = 'rss' | 'html' | 'playwright';

export type SourceRunStatus = 'running' | 'completed' | 'failed';

export type ArticleActionType =
  | 'favorite'
  | 'exclude'
  | 'hold'
  | 'mark_reviewed'
  | 'generate_blog_draft'
  | 'generate_x_post'
  | 'publish_to_wordpress'
  | 'regenerate_blog_draft';

export type DraftStatus = 'generated' | 'sent_to_wordpress' | 'published';

export interface Source {
  id: string;
  name: string;
  source_type: SourceType;
  base_url: string;
  list_url: string;
  extraction_config: Record<string, unknown>;
  enabled: boolean;
  priority: number;
  tags: string[];
  created_at: string;
  updated_at: string;
}

export interface SourceRun {
  id: string;
  source_id: string;
  run_type: string;
  status: SourceRunStatus;
  started_at: string;
  completed_at: string | null;
  items_found: number;
  items_inserted: number;
  error_message: string | null;
}

export interface Article {
  id: string;
  source_id: string;
  original_url: string;
  canonical_url: string;
  title: string;
  author: string | null;
  published_at: string | null;
  fetched_at: string;
  raw_html: string | null;
  extracted_text: string | null;
  excerpt: string | null;
  main_image_url: string | null;
  language: string;
  hash: string;
  created_at: string;
  updated_at: string;
}

export interface ArticleAiInsights {
  id: string;
  article_id: string;
  short_summary: string | null;
  long_summary: string | null;
  tags: string[];
  topics: string[];
  ai_ojisan_fit_score: number | null;
  x_post_potential_score: number | null;
  blog_post_potential_score: number | null;
  novelty_score: number | null;
  source_reliability_score: number | null;
  overall_score: number | null;
  reasoning: string | null;
  generated_at: string;
}

export interface ArticleAction {
  id: string;
  article_id: string;
  action_type: ArticleActionType;
  action_value: string | null;
  note: string | null;
  created_at: string;
}

export interface GeneratedDraft {
  id: string;
  article_id: string;
  draft_title: string;
  draft_outline: string | null;
  draft_body: string;
  wordpress_post_id: number | null;
  status: DraftStatus;
  generation_metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface GeneratedXPost {
  id: string;
  article_id: string;
  variant_label: 'direct' | 'analytical' | 'opinion';
  text: string;
  tone: string;
  created_at: string;
}

export interface BlogStyleChunk {
  id: string;
  source_post_id: string;
  post_title: string;
  post_url: string;
  published_at: string | null;
  category: string | null;
  tags: string[];
  section_title: string | null;
  chunk_index: number;
  chunk_text: string;
  topic_tags: string[];
  tone_tag: string | null;
  structure_type: string | null;
  style_tags: string[];
  embedding: number[] | null;
  created_at: string;
  updated_at: string;
}

// Joined / view types for admin UI
// Field names match Supabase join syntax (table_name as returned by .select())
export interface ArticleWithInsights extends Article {
  // Supabase returns the joined table with the table name as key
  sources?: Pick<Source, 'name' | 'source_type'> | null;
  article_ai_insights?: ArticleAiInsights | null;
  article_actions?: Pick<ArticleAction, 'action_type'>[];
}
