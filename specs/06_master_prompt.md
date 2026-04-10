# Master Prompt — AI Oji-san Blog System MVP

You are helping build a production-quality MVP for a private editorial workflow and public blog system called **AI Oji-san Blog System**.

Your task is to generate the initial implementation scaffold and begin building the system in a clean, modular, maintainable way.

Please read and follow all requirements below carefully.

---

# PROJECT CONTEXT

We are building a system with two main parts:

1. **Private Admin Dashboard / News App**
   - register scraping sources
   - ingest articles from selected sources
   - summarize and score them with AI
   - manually trigger blog draft generation
   - manually generate X post drafts
   - push generated blog drafts into WordPress as draft posts

2. **Public Blog Frontend**
   - editorial-style blog/media site
   - lightweight, readable, modern
   - built with Astro

Tech stack:
- Astro
- TypeScript
- Vercel Pro
- Supabase (Postgres)
- WordPress as headless draft CMS
- OpenAI first
- optional Anthropic support later
- RAG over past blog content using Supabase + pgvector
- scraping strategy: RSS first, HTML fetch second, Playwright only when needed

This is an MVP. Do not over-engineer.

---

# WHAT TO BUILD FIRST

Build the project foundation and the first working MVP scaffold covering these areas:

## 1. Project Structure
Create a clean Astro-based structure with separation for:
- public site
- admin dashboard
- API routes
- shared components
- shared services
- shared types
- styling system

## 2. Environment Config
Set up environment variable handling for:
- OPENAI_API_KEY
- SUPABASE_URL
- SUPABASE_ANON_KEY
- SUPABASE_SERVICE_ROLE_KEY
- WORDPRESS_BASE_URL
- WORDPRESS_USERNAME
- WORDPRESS_APP_PASSWORD
- optional ANTHROPIC_API_KEY

Add `.env.example`.

## 3. Supabase Schema Plan
Prepare database schema and migration plan for:
- sources
- source_runs
- articles
- article_ai_insights
- article_actions
- generated_drafts
- generated_x_posts
- blog_style_chunks

Include helpful indexes and uniqueness protections.

## 4. Admin UI Scaffold
Create initial admin dashboard pages:
- dashboard
- sources
- news feed
- draft history
- settings

The UI should be calm, editorial-workspace-like, and practical.
Use reusable components.
Prefer a clean and restrained design.

## 5. Source Management
Implement create/edit/list/enable/disable source management UI and backend hooks.

## 6. Ingestion Pipeline Scaffold
Create a service layer for ingestion with support for:
- RSS fetch
- HTML fetch
- article extraction pipeline scaffold

Do not fully implement Playwright-heavy logic yet.
Just leave extension points.

## 7. AI Layer Abstraction
Create an abstraction for AI providers.
Initially implement OpenAI support for:
- article summary
- editorial scoring
- blog draft generation
- X post draft generation

## 8. RAG Scaffold
Create the structure for past-blog ingestion and chunk retrieval.
Do not overbuild the embedding pipeline yet, but scaffold it cleanly.

## 9. WordPress Draft Sync Scaffold
Implement a reusable service for WordPress REST API draft creation.

## 10. Cron Scaffold
Create protected server routes intended for Vercel cron jobs.

---

# PRODUCT REQUIREMENTS

## Main Workflow
1. Admin registers sources
2. System ingests articles
3. AI summarizes and scores them
4. Admin reviews items in the news app
5. Admin clicks "Generate Blog Draft"
6. System uses past blog RAG + article context
7. System generates blog draft
8. System sends draft to WordPress as `draft`
9. Admin later edits and publishes manually

## Additional Workflow
- Admin can click "Generate X Posts"
- System creates 3 candidate X posts

---

# MVP FEATURE PRIORITY

Implement in this order:
1. foundation
2. Supabase schema
3. source management
4. ingestion scaffold
5. admin news feed scaffold
6. AI summary/scoring scaffold
7. RAG scaffold
8. blog draft generation scaffold
9. WordPress draft sync scaffold
10. X post draft generation scaffold

---

# DESIGN REQUIREMENTS

## Public Site Direction
The public site should feel like:
- a thoughtful technology/editorial publication
- a personal analysis blog
- clean, modern, restrained, readable

Reference spirit:
- Simon Willison
- Benedict Evans
- Every
- Anthropic Engineering
- OpenAI Developer Blog
- Vercel Blog

## Admin Dashboard Direction
The dashboard should feel like:
- calm editorial workspace
- practical
- information-dense
- easy to scan
- efficient for quick decisions

Avoid:
- flashy SaaS landing page aesthetics
- generic AI neon visuals
- cluttered dashboards
- crypto / guru / growth-hack visual language

---

# WRITING STYLE REQUIREMENTS

This system will later generate Japanese blog drafts.
The blog is not a generic AI summary site.
It should reflect a human editorial viewpoint.

The writing should aim for:
- intelligent but not pretentious
- readable but not shallow
- practical and thoughtful
- clear point of view
- not overly formulaic
- not empty AI-sounding language

When scaffolding prompts or AI services, keep this future requirement in mind.

---

# ENGINEERING REQUIREMENTS

- Use TypeScript
- Keep code clean and modular
- Separate server-only logic from client-safe logic
- Document major folders and services
- Add TODO comments only where useful
- Add clear extension points for future phases
- Prefer composable service abstractions
- Make ingestion idempotent where possible
- Add logging and error handling
- Keep secrets server-side only

---

# EXPECTED OUTPUT

Please produce the first-pass implementation with:

1. recommended folder structure
2. initial code scaffold
3. initial database schema plan
4. initial admin page structure
5. initial service abstraction layout
6. initial styling/token approach
7. notes on what is complete vs placeholder
8. prioritized next steps
