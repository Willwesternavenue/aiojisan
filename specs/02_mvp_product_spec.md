# AI Oji-san Blog System — MVP Product Spec

## Project Overview
Build a personal AI-assisted editorial system for a Japanese blog/media site called **AIおじさん.com**.

The system should:
1. Collect articles from selected online sources
2. Store and organize them in a private news dashboard
3. Let AI summarize, tag, score, and evaluate them
4. Allow the user to generate a blog draft with one click
5. Save generated drafts into WordPress as draft posts
6. Generate X post candidates for selected items
7. Support future expansion into more advanced automation

This is a private editorial workflow tool first, and a public blog/media site second.

---

## Core Product Goals
- Build a private news ingestion and editorial workflow system
- Make it easy to monitor relevant topics and potential blog ideas
- Reduce friction from discovery to blog drafting
- Preserve a human-in-the-loop publishing workflow
- Use past blog content via RAG to reflect the user's writing style
- Keep the system modular and maintainable for long-term use

---

## Tech Stack
- **Frontend / App**: Astro
- **Hosting**: Vercel Pro
- **Database**: Supabase (Postgres)
- **CMS for Draft Storage**: Self-hosted WordPress
- **AI APIs**: OpenAI first, optional Anthropic support later
- **Scraping**: RSS first, fetch/HTML extraction second, Playwright only when needed
- **Auth**: Simple private admin auth (Supabase Auth is acceptable)
- **RAG storage**: Supabase with pgvector

---

## High-Level Architecture

### Public Site
- Public blog frontend on Astro
- Fast, lightweight, editorial-style design
- Article list pages
- Article detail pages
- Category/tag pages
- About page
- X profile link / CTA

### Private Admin Dashboard
- News source management
- News item list and filtering
- AI summaries and scores
- Manual actions:
  - favorite
  - exclude
  - hold
  - generate blog draft
  - generate X post candidates
- Draft generation history
- Settings page

### WordPress
Used only as a headless draft CMS.
The generated article should be posted to WordPress via REST API as a **draft**.
Public rendering should remain in Astro.

---

## MVP Scope

### MVP Features
1. Admin login
2. Source registration and management
3. Scheduled ingestion from RSS / normal HTML pages
4. Store scraped articles in Supabase
5. News list view in admin
6. Article detail view in admin
7. AI summary generation
8. AI scoring / editorial relevance scoring
9. Manual "Generate Blog Draft" button
10. Manual "Generate X Post" button
11. Send blog draft to WordPress as draft
12. Store AI outputs and action history
13. Basic RAG over past blog content
14. Basic public blog frontend in Astro

### Explicitly Out of Scope for MVP
- Fully automatic blog publishing
- Full X auto-posting
- note integration
- Advanced analytics dashboard
- Complex multi-user roles
- Full Playwright-first scraping engine
- Personalized recommendation learning
- Style fine-tuning training pipeline

---

## Data Models

### sources
Fields:
- id
- name
- source_type (rss, html, playwright)
- base_url
- list_url
- extraction_config (json)
- enabled
- priority
- tags
- created_at
- updated_at

### source_runs
Fields:
- id
- source_id
- run_type
- status
- started_at
- completed_at
- items_found
- items_inserted
- error_message

### articles
Fields:
- id
- source_id
- original_url
- canonical_url
- title
- author
- published_at
- fetched_at
- raw_html
- extracted_text
- excerpt
- main_image_url
- language
- hash
- created_at
- updated_at

### article_ai_insights
Fields:
- id
- article_id
- short_summary
- long_summary
- tags
- topics
- ai_ojisan_fit_score
- x_post_potential_score
- blog_post_potential_score
- novelty_score
- source_reliability_score
- overall_score
- reasoning
- generated_at

### article_actions
Fields:
- id
- article_id
- action_type
- action_value
- note
- created_at

Action examples:
- favorite
- exclude
- hold
- generate_blog_draft
- generate_x_post
- publish_to_wordpress

### blog_style_chunks
Fields:
- id
- source_post_id
- chunk_text
- embedding
- tone_tags
- format_tags
- created_at

### generated_drafts
Fields:
- id
- article_id
- draft_title
- draft_outline
- draft_body
- wordpress_post_id
- status
- generation_metadata
- created_at
- updated_at

### generated_x_posts
Fields:
- id
- article_id
- variant_label
- text
- tone
- created_at

---

## Admin Screens

### 1. Dashboard
- Recent source runs
- Number of new items
- Number of high-score items
- Number of drafts generated
- Quick links

### 2. Sources
- Source list
- Create/edit source
- Enable/disable source
- Define source type
- Define extraction method
- Manual test run button

### 3. News Feed
- Sort by newest / score / source / fit
- Filters:
  - source
  - topic
  - score range
  - favorites
  - excluded
  - drafted
- Each row/card should show:
  - title
  - source
  - date
  - short summary
  - score badges
  - quick actions

### 4. News Detail
- Full extracted text
- AI summaries
- Tags and scores
- Related past blog chunks
- Buttons:
  - favorite
  - exclude
  - generate blog draft
  - generate X posts

### 5. Draft History
- List of generated drafts
- View WordPress sync status
- Regenerate button
- Open in WordPress button

### 6. Settings
- API integration settings
- WordPress endpoint settings
- Scoring thresholds
- Cron settings display
- Future model configuration

---

## Public Site Pages

### Home
- Hero section with site identity
- Featured recent articles
- Category/topic sections
- Latest articles list

### Article List
- Card/list layout
- Clean editorial browsing experience

### Article Detail
- Strong readability
- Clear metadata
- Clean typography
- Optional related articles

### About
- What AIおじさん.com is
- Editorial perspective
- X profile link

---

## Editorial AI Workflow

### Step 1: Ingestion
- Pull content from registered sources
- Prefer RSS
- Use plain fetch and parsing when possible
- Use Playwright only when necessary

### Step 2: Extraction
- Extract title, body text, date, author, canonical URL
- Store raw and cleaned versions
- Deduplicate by canonical URL and content hash

### Step 3: AI Processing
For each new article:
- generate short summary
- generate long summary
- tag topic and category
- score:
  - AI Oji-san relevance
  - blog potential
  - X potential
  - novelty
  - reliability

### Step 4: Manual Editorial Action
User can:
- favorite
- exclude
- hold
- generate blog draft
- generate X post drafts

### Step 5: Blog Draft Generation
When user clicks generate:
- retrieve relevant style chunks from past blog RAG
- generate:
  - 3 title options
  - 1 outline
  - 1 full blog draft
- save result in database
- send to WordPress as draft

### Step 6: X Draft Generation
Generate 3 variants:
- direct / informative
- intellectual / analytical
- sharper / more opinionated

---

## RAG Requirements
- Ingest past blog posts into Supabase
- Split into meaningful chunks
- Store embeddings with metadata
- Metadata should include:
  - topic
  - tone
  - structure type
  - writing style tags
- Retrieval should prioritize:
  - thematic similarity
  - stylistic similarity
  - high-quality previously published posts

---

## Scraping Strategy
Priority order:
1. RSS
2. Simple HTML fetch + extraction
3. Playwright only when needed

Do NOT build everything around Playwright initially.

Use source-specific extraction configs when needed.

---

## WordPress Integration
- Use WordPress REST API
- Use Application Password authentication
- Create posts as `draft`
- Save returned WordPress post ID
- Allow admin to open WordPress draft from dashboard

---

## Cron Jobs
Use Vercel Cron Jobs.

Initial jobs:
- every 15 min: fetch enabled sources
- every hour: AI process newly ingested items
- twice daily: refresh priority sources

Cron endpoints should be protected and server-side only.

---

## Implementation Priorities
### Phase 1
- Astro app scaffold
- Supabase schema
- Admin auth
- Source management UI
- Basic ingestion pipeline

### Phase 2
- News list UI
- Article detail UI
- AI summary and scoring pipeline

### Phase 3
- RAG ingestion for past blog content
- Blog draft generation
- X post generation

### Phase 4
- WordPress draft sync
- Draft history UI
- Public site basic implementation

---

## Code Quality Requirements
- TypeScript everywhere
- Clear folder structure
- Reusable components
- Server-only API logic for all secrets
- Environment variables documented
- Good error handling
- Logging for cron jobs and ingestion runs
- Idempotent ingestion where possible

---

## Environment Variables
Expected environment variables:
- OPENAI_API_KEY
- ANTHROPIC_API_KEY (optional later)
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- WORDPRESS_BASE_URL
- WORDPRESS_USERNAME
- WORDPRESS_APP_PASSWORD

---

## Deliverables for First Pass
Please generate:
1. Project folder structure
2. Database schema proposal
3. Initial Astro routes
4. Initial admin dashboard layout
5. Initial Supabase integration
6. Ingestion pipeline scaffold
7. WordPress draft sync scaffold
8. AI service abstraction layer
9. MVP-ready TODO checklist

Do not over-engineer. Build a clean, extensible MVP first.
