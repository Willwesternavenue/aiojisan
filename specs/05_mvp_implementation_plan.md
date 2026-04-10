# AI Oji-san Blog System — MVP Implementation Plan

## Guiding Principles
- Build for maintainability first
- Prefer a clean MVP over over-engineering
- Keep all sensitive logic server-side
- Make the editorial workflow explicit and traceable
- Preserve human review before publishing
- Optimize for long-term extensibility

---

## Phase 0 — Foundation / Project Setup

### Goal
Set up the project skeleton, environment, shared utilities, and deployment-ready foundation.

### Tasks
- Initialize Astro project with TypeScript
- Configure Tailwind (or equivalent utility-first styling)
- Set up project structure for:
  - public site
  - admin dashboard
  - server API routes
  - shared UI components
  - shared lib utilities
- Add environment variable validation
- Set up Supabase client utilities:
  - client-side safe usage
  - server-side admin usage
- Create initial authentication guard for admin routes
- Create basic app layout and admin layout
- Add logging utility
- Add shared type definitions
- Add `.env.example`

### Deliverables
- Clean project scaffold
- Running Astro app
- Admin route protection scaffold
- Environment configuration scaffold
- Deployment-ready repository structure

---

## Phase 1 — Database Schema + Supabase Integration

### Goal
Create the core database models and wire the app to Supabase.

### Tasks
- Create SQL migrations or schema definitions for:
  - sources
  - source_runs
  - articles
  - article_ai_insights
  - article_actions
  - generated_drafts
  - generated_x_posts
  - blog_style_chunks
- Add indexes
- Add uniqueness protections:
  - canonical_url
  - content hash
- Add created_at / updated_at fields consistently
- Add helper queries for:
  - fetch enabled sources
  - fetch unprocessed articles
  - fetch top-scored items
  - fetch recent drafts
- Add data access layer or repository abstraction

### Deliverables
- Complete initial Supabase schema
- Typed database access functions
- Query helpers for admin and ingestion flows

---

## Phase 2 — Source Management UI

### Goal
Allow the user to register and manage scraping sources.

### Tasks
- Build Sources page in admin
- Create source list table/cards
- Create source create/edit form
- Source fields:
  - name
  - type (rss / html / playwright)
  - base_url
  - list_url
  - extraction config
  - enabled
  - priority
  - tags
- Add validation
- Add enable/disable toggle
- Add test run action
- Add source status display

### Deliverables
- Functional source management page
- Create/edit/delete/update source flow
- Manual test-run action scaffold

---

## Phase 3 — Ingestion Pipeline (RSS / HTML First)

### Goal
Collect articles from configured sources and store them.

### Tasks
- Build ingestion service abstraction
- Support:
  - RSS source fetch
  - HTML list page fetch
- Extract candidate links
- Fetch article page
- Extract:
  - title
  - author
  - date
  - canonical URL
  - body text
  - excerpt
  - main image if available
- Store raw HTML and cleaned text
- Deduplicate by:
  - canonical URL
  - normalized hash
- Record source run history
- Add basic error handling and retry-safe behavior

### Deliverables
- Working ingestion pipeline for RSS and HTML sources
- Stored article records in Supabase
- Source run logs

---

## Phase 4 — Admin News Feed

### Goal
Create the private news dashboard for viewing collected items.

### Tasks
- Build News Feed page
- Show article list/cards with:
  - title
  - source
  - date
  - summary placeholder
  - status badges
  - quick actions
- Add filters:
  - source
  - score range
  - favorites
  - excluded
  - drafted
- Add sorting:
  - newest
  - highest score
  - best blog potential
  - best X potential
- Add detail page or modal for each item
- Add extracted text display
- Add raw metadata display

### Deliverables
- Functional news dashboard
- Filterable and actionable article feed
- Article detail UI

---

## Phase 5 — AI Summary + Editorial Scoring

### Goal
Process newly ingested items with AI.

### Tasks
- Create AI service abstraction
- Add summarization pipeline:
  - short summary
  - long summary
- Add topic and tags extraction
- Add editorial scoring:
  - AI Oji-san fit
  - blog post potential
  - X post potential
  - novelty
  - source reliability
  - overall score
- Store AI outputs in article_ai_insights
- Display AI outputs in admin
- Add batch processing endpoint for cron use

### Deliverables
- Working AI processing layer
- Persisted summaries and scores
- Admin UI for AI insights

---

## Phase 6 — Manual Editorial Actions

### Goal
Add human-in-the-loop workflow controls.

### Tasks
- Add actions:
  - favorite
  - exclude
  - hold
  - mark reviewed
- Store actions in article_actions
- Reflect action state in UI
- Add action filters in feed
- Ensure quick action UX is efficient

### Deliverables
- Editable workflow state
- Action history persistence
- Clear admin interaction loop

---

## Phase 7 — RAG Ingestion for Past Blog Content

### Goal
Prepare writing-style-aware retrieval from past blog posts.

### Tasks
- Build past blog import utility
- Ingest past published blog posts
- Chunk content into meaningful segments
- Add metadata fields:
  - topic
  - tone
  - structure type
  - style tags
- Generate embeddings
- Store in blog_style_chunks
- Add retrieval service for:
  - top relevant chunks by topic
  - top relevant chunks by style
- Prepare prompt assembly helper

### Deliverables
- Working blog style RAG store
- Retrieval utility for draft generation
- Embedding pipeline scaffold

---

## Phase 8 — Blog Draft Generation

### Goal
Generate a blog draft from a selected news item.

### Tasks
- Add "Generate Blog Draft" action
- When triggered:
  - fetch article text and metadata
  - fetch AI summaries and scores
  - retrieve relevant style chunks from RAG
  - generate:
    - 3 title options
    - 1 outline
    - 1 full draft
- Save result in generated_drafts
- Show generated output in admin UI
- Add regenerate option

### Deliverables
- One-click blog draft generation
- Stored draft outputs
- Admin draft preview UI

---

## Phase 9 — WordPress Draft Sync

### Goal
Push generated drafts into WordPress as draft posts.

### Tasks
- Implement WordPress REST API client
- Use Application Password authentication
- Create draft post with:
  - selected title
  - generated body
  - metadata if needed
- Save WordPress post ID
- Save sync status
- Add "Open in WordPress" link
- Add error handling and retry-safe sync

### Deliverables
- Working WordPress draft creation
- Draft sync state visible in admin

---

## Phase 10 — X Post Draft Generation

### Goal
Generate X post candidates from selected news items.

### Tasks
- Add "Generate X Posts" action
- Generate 3 variants:
  - direct / informative
  - analytical / intelligent
  - sharper / opinion-led
- Save in generated_x_posts
- Show variants in admin
- Add easy copy-to-clipboard UX

### Deliverables
- Working X draft generation flow
- Reusable X draft UI

---

## Phase 11 — Public Blog Frontend

### Goal
Build the public-facing Astro site.

### Tasks
- Create homepage
- Create article list page
- Create article detail page
- Create category/tag pages
- Create About page
- Add editorial hero section
- Add clean typography and article reading layout
- Connect to CMS/content source as needed
- Keep performance high

### Deliverables
- Usable public site
- Editorial-style visual design
- Strong readability

---

## Phase 12 — Cron Jobs

### Goal
Automate recurring background workflows.

### Tasks
- Add Vercel cron endpoints:
  - fetch enabled sources
  - process unscored items
  - refresh high-priority sources
- Add secret protection for cron endpoints
- Add run logging
- Make ingestion and AI jobs idempotent where possible

### Deliverables
- Stable scheduled ingestion and processing
- Logged recurring workflows

---

## MVP Completion Criteria
The MVP is complete when:
- sources can be added and managed
- articles are collected and stored
- AI summaries and scores are generated
- user can review items in admin
- user can generate blog drafts
- drafts are saved to WordPress
- X post drafts can be generated
- public site skeleton is live
