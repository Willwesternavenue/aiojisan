# AI Oji-san Blog System — Past Blog RAG Ingestion Spec

## Goal
Build a clean ingestion pipeline for past blog posts so they can be used as retrieval context for future AI-generated blog drafts and X post drafts.

The purpose is NOT to copy old posts.
The purpose is to capture:
- writing style tendencies
- argument structure
- editorial tone
- practical voice
- recurring phrasing patterns
- useful examples of how the author frames ideas

This data will later be used in a RAG pipeline for style-aware draft generation.

---

## Input Data
Assume past blog posts are available in JSON format.

Each blog post should include:
- id
- title
- url
- published_at
- category
- tags
- content

Optional:
- excerpt
- featured_image_url
- status

---

## Required Processing Steps

### 1. Normalize / Clean
For each blog post:
- remove unnecessary HTML
- remove embeds, scripts, widgets, ads, share blocks
- preserve meaningful headings
- preserve paragraph structure
- output clean plain text or normalized markdown-like structure

### 2. Chunking
Split each blog post into meaningful chunks.

Chunking rules:
- prefer heading-based chunking when headings exist
- otherwise chunk by paragraph groups
- each chunk should represent one coherent idea
- target chunk length: roughly 300 to 800 Japanese characters
- avoid extremely short chunks unless necessary
- merge weak fragments when appropriate
- split overly long sections when necessary

### 3. Metadata Extraction
For each chunk, generate metadata:
- topic_tags
- tone_tag
- structure_type
- style_tags

Definitions:
- topic_tags: content topic labels
- tone_tag: primary tone of the chunk
- structure_type: rhetorical / structural pattern
- style_tags: writing-style characteristics

### 4. Embedding Preparation
Prepare each chunk for embedding generation.
Each chunk should be stored independently and later embedded.

### 5. Storage
Store results in a `blog_style_chunks` table in Supabase.

---

## Output Requirements

Each chunk record should contain:
- id
- post_id
- post_title
- post_url
- published_at
- category
- tags
- section_title
- chunk_index
- chunk_text
- topic_tags
- tone_tag
- structure_type
- style_tags
- embedding
- created_at
- updated_at

---

## Metadata Guidelines

### topic_tags examples
- AI
- 生成AI
- AIエージェント
- 日本企業
- スタートアップ
- ブログ運営
- マーケティング
- 業務改善
- 海外展開

### tone_tag examples
- 知的
- 実務的
- 軽快
- 解説寄り
- やや強め
- エッセイ寄り

### structure_type examples
- 要点先出し
- 問題提起→解説→示唆
- ニュース要約→見解
- 比較型
- 仮説提示型
- 実務論点整理型

### style_tags examples
- 率直
- 実務感あり
- 段落短め
- 比喩少なめ
- 断定控えめ
- 論点整理型
- 読みやすい
- 少し会話的

---

## Retrieval Intent
This data will later be used to retrieve:
- topically similar chunks
- stylistically similar chunks
- high-quality representative chunks

The generation system should use retrieved chunks as style guidance, not as text to copy.

---

## Engineering Requirements
- Use TypeScript
- Build a reusable ingestion script/service
- Keep processing modular:
  - normalize step
  - chunk step
  - metadata extraction step
  - embedding step
  - database insert step
- Make the pipeline re-runnable
- Avoid duplicate inserts
- Make it easy to test on a small set of posts first

---

## Deliverables
Please generate:
1. a JSON schema for input blog posts
2. a TypeScript ingestion pipeline scaffold
3. chunking logic proposal
4. metadata extraction prompt scaffold
5. Supabase insert logic scaffold
6. a small testable example flow
