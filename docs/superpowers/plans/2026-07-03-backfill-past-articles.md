# Backdated Past-Article Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish the 20 highest-scored articles missed during the 2026-06-21→07-02 scoring outage, backdated to their original publish dates, reusing the existing generation pipeline.

**Architecture:** Add a backdate (`publishDate`) + `skipSocial` option to the existing `generateDraftForArticle`/`createWordPressDraft` path. Expose a `CRON_SECRET`-protected `/api/admin/backfill-article` endpoint that backdate-publishes one article. A local Node orchestrator selects the top-20 already-scored window articles, shows a dry-run, and on `--execute` POSTs each to the endpoint.

**Tech Stack:** Astro 6 (SSR) on Vercel, Supabase JS, WordPress REST. No test framework — verification is `npx astro check` plus the script's own dry-run.

## Global Constraints

- No test framework exists; verification is `npx astro check` (0 errors) plus manual/dry-run checks. Do not add tests.
- Repo is ESM (`"type": "module"`); standalone scripts use the `.mjs` extension.
- Default behavior of `generateDraftForArticle` and `createWordPressDraft` must be unchanged when the new options are omitted (the hourly cron relies on them).
- The backfill endpoint publishes live content and MUST require `CRON_SECRET` via `requireCronAuth`.

---

### Task 1: Add backdate + skip-social to the generation path

**Files:**
- Modify: `src/services/wordpress/client.ts` (WpPostPayload interface; `createWordPressDraft`)
- Modify: `src/services/drafts/generate.ts` (`generateDraftForArticle`)

**Interfaces:**
- Produces: `createWordPressDraft(title, body, excerpt?, slug?, status?, categories?, publishDate?)` — `publishDate` is an ISO string; when set, the post is backdated via `date_gmt`.
- Produces: `generateDraftForArticle(articleId, { autoPublish?, publishDate?, skipSocial? })` — `publishDate` backdates the WP post; `skipSocial` suppresses the X auto-post.

- [ ] **Step 1: Add `date_gmt` to the WP payload type**

In `src/services/wordpress/client.ts`, the `WpPostPayload` interface is:

```typescript
interface WpPostPayload {
  title: string;
  content: string;
  status: 'draft' | 'publish' | 'private';
  excerpt?: string;
  categories?: number[];
  tags?: number[];
  featured_media?: number;
  meta?: Record<string, unknown>;
}
```

Add a `date_gmt` field:

```typescript
interface WpPostPayload {
  title: string;
  content: string;
  status: 'draft' | 'publish' | 'private';
  excerpt?: string;
  categories?: number[];
  tags?: number[];
  featured_media?: number;
  meta?: Record<string, unknown>;
  date_gmt?: string;
}
```

- [ ] **Step 2: Add the `publishDate` parameter to `createWordPressDraft`**

In `src/services/wordpress/client.ts`, change the signature and payload. Current:

```typescript
export async function createWordPressDraft(
  title: string,
  body: string,
  excerpt?: string,
  slug?: string,
  status: 'draft' | 'publish' = 'draft',
  categories?: number[],
): Promise<{ id: number; editUrl: string }> {
  logger.info('Creating WordPress post', { title, slug, status });

  const htmlBody = markdownToHtml(body);

  const payload: WpPostPayload = {
    title,
    content: htmlBody,
    status,
    excerpt,
    featured_media: PLACEHOLDER_MEDIA_ID,
    ...(categories && categories.length > 0 ? { categories } : {}),
    ...(slug ? { slug } : {}),
  };
```

Replace with:

```typescript
export async function createWordPressDraft(
  title: string,
  body: string,
  excerpt?: string,
  slug?: string,
  status: 'draft' | 'publish' = 'draft',
  categories?: number[],
  publishDate?: string,
): Promise<{ id: number; editUrl: string }> {
  logger.info('Creating WordPress post', { title, slug, status, publishDate });

  const htmlBody = markdownToHtml(body);

  const payload: WpPostPayload = {
    title,
    content: htmlBody,
    status,
    excerpt,
    featured_media: PLACEHOLDER_MEDIA_ID,
    ...(categories && categories.length > 0 ? { categories } : {}),
    ...(slug ? { slug } : {}),
    // Backdate the post (WordPress publishes a past-dated post at that date)
    ...(publishDate ? { date_gmt: new Date(publishDate).toISOString().slice(0, 19) } : {}),
  };
```

- [ ] **Step 3: Add options and wire them through `generateDraftForArticle`**

In `src/services/drafts/generate.ts`:

(a) Change the signature and options destructure. Current:

```typescript
export async function generateDraftForArticle(
  articleId: string,
  options: { autoPublish?: boolean } = {},
): Promise<{ wpPostId: number } | null> {
```

to:

```typescript
export async function generateDraftForArticle(
  articleId: string,
  options: { autoPublish?: boolean; publishDate?: string; skipSocial?: boolean } = {},
): Promise<{ wpPostId: number } | null> {
```

(b) Change the destructure. Current:

```typescript
  const { autoPublish = false } = options;
```

to:

```typescript
  const { autoPublish = false, publishDate, skipSocial = false } = options;
```

(c) Pass `publishDate` to `createWordPressDraft`. Current:

```typescript
  const { id: wpPostId } = await createWordPressDraft(
    selectedTitle,
    draft.body,
    insights?.short_summary ?? undefined,
    draft.slug,
    wpStatus,
    categoryIds,
  );
```

to:

```typescript
  const { id: wpPostId } = await createWordPressDraft(
    selectedTitle,
    draft.body,
    insights?.short_summary ?? undefined,
    draft.slug,
    wpStatus,
    categoryIds,
    publishDate,
  );
```

(d) Wrap ONLY the X-post block in `if (!skipSocial)`. The featured-image block stays as-is. Current (the X block, immediately after the image try/catch, inside `if (autoPublish) {`):

```typescript
    try {
      const publicUrl = getPublicArticleUrl(draft.slug);
      const xPosts = await ai.generateXPosts({
        articleTitle: selectedTitle,
        articleUrl: publicUrl,
        shortSummary: insights?.short_summary ?? '',
        topics: insights?.topics ?? [],
      });
      const text = formatXPost(xPosts.direct, publicUrl, getHashtags(pillarCategories));
      const result = await postToX({ text, articleId, url: publicUrl });

      await db.from('generated_x_posts').insert({
        article_id: articleId,
        variant_label: 'direct',
        text,
        tone: result.tweeted ? '自動投稿済み' : '自動投稿スキップ',
      });
    } catch (xErr) {
      logger.warn('X auto-post failed, post already published', {
        articleId,
        wpPostId,
        err: String(xErr),
      });
    }
```

Wrap it so it becomes:

```typescript
    if (!skipSocial) {
      try {
        const publicUrl = getPublicArticleUrl(draft.slug);
        const xPosts = await ai.generateXPosts({
          articleTitle: selectedTitle,
          articleUrl: publicUrl,
          shortSummary: insights?.short_summary ?? '',
          topics: insights?.topics ?? [],
        });
        const text = formatXPost(xPosts.direct, publicUrl, getHashtags(pillarCategories));
        const result = await postToX({ text, articleId, url: publicUrl });

        await db.from('generated_x_posts').insert({
          article_id: articleId,
          variant_label: 'direct',
          text,
          tone: result.tweeted ? '自動投稿済み' : '自動投稿スキップ',
        });
      } catch (xErr) {
        logger.warn('X auto-post failed, post already published', {
          articleId,
          wpPostId,
          err: String(xErr),
        });
      }
    }
```

(e) Record `backfilled` in metadata. Current `generation_metadata` object:

```typescript
    generation_metadata: {
      titleOptions: draft.titleOptions,
      styleChunksUsed,
      model: draft.model,
      auto_generated: true,
      auto_published: autoPublish,
      pillarCategories: pillarCategories.map(category => category.slug),
    },
```

to:

```typescript
    generation_metadata: {
      titleOptions: draft.titleOptions,
      styleChunksUsed,
      model: draft.model,
      auto_generated: true,
      auto_published: autoPublish,
      backfilled: Boolean(publishDate),
      pillarCategories: pillarCategories.map(category => category.slug),
    },
```

- [ ] **Step 4: Type-check**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/services/wordpress/client.ts src/services/drafts/generate.ts
git commit -m "Add backdate (publishDate) and skipSocial options to draft generation"
```

---

### Task 2: Backdate-publish endpoint

**Files:**
- Create: `src/pages/api/admin/backfill-article.ts`

**Interfaces:**
- Consumes: `generateDraftForArticle(articleId, { autoPublish, publishDate, skipSocial })` from Task 1; `requireCronAuth(request)` from `@/lib/auth`.

- [ ] **Step 1: Create the endpoint**

Create `src/pages/api/admin/backfill-article.ts`:

```typescript
// API: Backdate-publish a single past article (one-off backfill).
// Protected by CRON_SECRET because it publishes live content.

import type { APIRoute } from 'astro';
import { requireCronAuth } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase/server';
import { generateDraftForArticle } from '@/services/drafts/generate';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:backfill-article');

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const POST: APIRoute = async ({ request }) => {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  let articleId: string | null = null;
  try {
    const body = (await request.json()) as { article_id?: string };
    articleId = body.article_id ?? null;
  } catch {
    articleId = null;
  }

  if (!articleId) return json({ ok: false, error: 'Missing article_id' }, 400);

  const db = getAdminClient();
  const { data: article, error } = await db
    .from('articles')
    .select('published_at, fetched_at')
    .eq('id', articleId)
    .single();

  if (error || !article) return json({ ok: false, error: 'Article not found' }, 404);

  const publishDate = (article.published_at ?? article.fetched_at) as string;
  logger.info('Backfilling article', { articleId, publishDate });

  try {
    const result = await generateDraftForArticle(articleId, {
      autoPublish: true,
      publishDate,
      skipSocial: true,
    });
    return json({ ok: true, wpPostId: result?.wpPostId ?? null, skipped: result === null });
  } catch (err) {
    logger.error('Backfill failed', { articleId, err: String(err) });
    return json({ ok: false, error: String(err) }, 500);
  }
};
```

- [ ] **Step 2: Type-check**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/admin/backfill-article.ts
git commit -m "Add CRON_SECRET-protected backfill-article endpoint"
```

---

### Task 3: Local orchestrator script (dry-run + execute)

**Files:**
- Create: `scripts/backfill-past-articles.mjs`

**Interfaces:**
- Consumes: `POST https://www.aiojisan.com/api/admin/backfill-article` (from Task 2) with `Authorization: Bearer <CRON_SECRET>` and JSON `{ article_id }`.

- [ ] **Step 1: Create the orchestrator**

Create `scripts/backfill-past-articles.mjs`:

```javascript
// One-off: backdate-publish the top-N scored articles from the scoring outage window.
// Dry run (default): prints the selection. Execute: node scripts/backfill-past-articles.mjs --execute [--limit=N]

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const getEnv = (k) => (env.match(new RegExp('^' + k + '\\s*=\\s*"?([^"\\n]+)"?', 'm')) || [])[1]?.trim();

const SUPABASE_URL = getEnv('SUPABASE_URL');
const SERVICE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
const CRON_SECRET = getEnv('CRON_SECRET');
const SITE = 'https://www.aiojisan.com';

const WINDOW_LO = '2026-06-21T00:00:00Z';
const WINDOW_HI = '2026-07-02T23:59:59Z';
const TOP_N = 20;

const execute = process.argv.includes('--execute');
const limitArg = (process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1];
const limit = limitArg ? Number(limitArg) : null;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const { data, error } = await db
  .from('articles')
  .select('id, title, published_at, fetched_at, article_ai_insights!inner(overall_score)')
  .gte('fetched_at', WINDOW_LO)
  .lte('fetched_at', WINDOW_HI)
  .limit(3000);

if (error) {
  console.error('Query failed:', error.message);
  process.exit(1);
}

const rows = (data || [])
  .map((a) => {
    const ins = Array.isArray(a.article_ai_insights) ? a.article_ai_insights[0] : a.article_ai_insights;
    return { id: a.id, score: ins?.overall_score, backdate: a.published_at ?? a.fetched_at, title: a.title || '' };
  })
  .filter((r) => r.score != null)
  .sort((a, b) => b.score - a.score)
  .slice(0, TOP_N);

const targets = limit ? rows.slice(0, limit) : rows;

console.log(`\nTop ${rows.length} scored articles in window (${execute ? 'EXECUTE' : 'DRY RUN'}${limit ? `, limit ${limit}` : ''}):\n`);
rows.forEach((r, i) => {
  const mark = i < targets.length ? '>' : ' ';
  console.log(`${mark} ${String(i + 1).padStart(2)}. score=${r.score}  ${String(r.backdate).slice(0, 10)}  ${r.title.slice(0, 60)}`);
});

if (!execute) {
  console.log('\n(dry run — nothing published. Re-run with --execute to publish, or --execute --limit=1 for a canary.)');
  process.exit(0);
}

console.log(`\nExecuting ${targets.length} backfill(s)...\n`);
let ok = 0;
let fail = 0;
for (const [i, r] of targets.entries()) {
  try {
    const res = await fetch(`${SITE}/api/admin/backfill-article`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
      body: JSON.stringify({ article_id: r.id }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok) {
      ok++;
      console.log(`${i + 1}/${targets.length} OK  wpPostId=${j.wpPostId}${j.skipped ? ' (skipped: draft exists)' : ''}  | ${r.title.slice(0, 40)}`);
    } else {
      fail++;
      console.log(`${i + 1}/${targets.length} FAIL ${res.status} ${j.error || ''}  | ${r.title.slice(0, 40)}`);
    }
  } catch (e) {
    fail++;
    console.log(`${i + 1}/${targets.length} ERROR ${String(e)}  | ${r.title.slice(0, 40)}`);
  }
}
console.log(`\nDone. ok=${ok} fail=${fail}`);
```

- [ ] **Step 2: Verify the dry-run runs and lists 20 articles**

Run: `node scripts/backfill-past-articles.mjs`
Expected: prints "Top 20 scored articles in window (DRY RUN)" followed by 20 numbered rows (score, date, title), then the dry-run notice. No network calls, no publishing.

- [ ] **Step 3: Commit**

```bash
git add scripts/backfill-past-articles.mjs
git commit -m "Add local orchestrator for past-article backfill (dry-run + execute)"
```

---

## Execution / Rollout (after all tasks committed)

This is the actual backfill run — performed WITH the user, not part of the code tasks:

1. Merge + push + wait for Vercel deploy (endpoint must be live).
2. `node scripts/backfill-past-articles.mjs` → review the dry-run list of 20 with the user.
3. On approval, canary: `node scripts/backfill-past-articles.mjs --execute --limit=1` → verify in WordPress the post is backdated, has body + image + category.
4. If good, run the rest: `node scripts/backfill-past-articles.mjs --execute` (idempotent — the first one is skipped as its draft already exists).

## Notes / Out of Scope

- The endpoint is intentionally the only new permanent surface; selection lives in the throwaway-style script. No admin UI.
- Selection is the top-20 already-scored window articles (all ≥8.0), not a re-score of all 2,672 — by design.
- `generateDraftForArticle` skips articles that already have a draft, so re-runs never double-publish.
