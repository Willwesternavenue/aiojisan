# Featured Image Backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin button that finds published articles still using the placeholder featured image and generates real Gemini featured images for up to 10 of them per click.

**Architecture:** A WordPress client helper lists published posts whose `featured_media` equals the placeholder id (125). A service caps the batch and calls the existing `generateAndAttachFeaturedImage` for each, tallying results. An admin API route runs it and redirects back with counts; the drafts page gets a button and a result banner.

**Tech Stack:** Astro 6 (SSR), WordPress REST, `@google/genai` (existing image path). No test framework — verification is `npx astro check` plus a manual dev-server run.

---

### Task 1: List published posts with the placeholder image

**Files:**
- Modify: `src/services/wordpress/client.ts`

- [ ] **Step 1: Add the helper and supporting types/util**

In `src/services/wordpress/client.ts`, add the following at the end of the file (after `generateAndAttachFeaturedImage`). It reuses the existing module-private `wpFetch` and `PLACEHOLDER_MEDIA_ID`:

```typescript
export interface PlaceholderPost {
  id: number;
  title: string;
  summary: string;
  slug: string;
}

interface WpListPost {
  id: number;
  slug: string;
  featured_media: number;
  title: { rendered: string };
  excerpt: { rendered: string };
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * List published posts that still have the placeholder featured image
 * (i.e. image generation never succeeded for them).
 */
export async function listPublishedPostsWithPlaceholderImage(): Promise<PlaceholderPost[]> {
  const result: PlaceholderPost[] = [];
  let page = 1;
  while (true) {
    let batch: WpListPost[];
    try {
      batch = await wpFetch<WpListPost[]>(
        `/posts?status=publish&per_page=100&_fields=id,slug,featured_media,title,excerpt&page=${page}`,
      );
    } catch (err) {
      // WordPress returns 400 (rest_post_invalid_page_number) when paging past the end
      const msg = String(err);
      if (msg.includes('invalid_page_number') || msg.includes('error 400')) break;
      throw err;
    }
    if (batch.length === 0) break;
    for (const p of batch) {
      if (p.featured_media === PLACEHOLDER_MEDIA_ID) {
        result.push({
          id: p.id,
          title: stripHtml(p.title?.rendered ?? ''),
          summary: stripHtml(p.excerpt?.rendered ?? ''),
          slug: p.slug,
        });
      }
    }
    if (batch.length < 100) break;
    page++;
  }
  return result;
}
```

- [ ] **Step 2: Type-check**

Run: `npx astro check`
Expected: 0 errors. (`wpFetch` and `PLACEHOLDER_MEDIA_ID` are already defined earlier in this file.)

- [ ] **Step 3: Commit**

```bash
git add src/services/wordpress/client.ts
git commit -m "Add listPublishedPostsWithPlaceholderImage WP helper"
```

---

### Task 2: Backfill service

**Files:**
- Create: `src/services/images/backfill.ts`

- [ ] **Step 1: Create the service**

Create `src/services/images/backfill.ts`:

```typescript
// Backfill featured images for published posts that still use the placeholder.

import {
  listPublishedPostsWithPlaceholderImage,
  generateAndAttachFeaturedImage,
} from '@/services/wordpress/client';
import { createLogger } from '@/lib/logger';

const logger = createLogger('image-backfill');

const BACKFILL_LIMIT = 10;

export interface BackfillResult {
  totalMissing: number;
  succeeded: number;
  failed: number;
  remaining: number;
}

/**
 * Generate and attach real featured images for up to `limit` published posts
 * that still have the placeholder image. Per-post failures are tallied, not
 * thrown, so one bad post does not abort the batch.
 */
export async function backfillMissingFeaturedImages(
  limit: number = BACKFILL_LIMIT,
): Promise<BackfillResult> {
  const missing = await listPublishedPostsWithPlaceholderImage();
  const totalMissing = missing.length;
  const batch = missing.slice(0, limit);

  let succeeded = 0;
  let failed = 0;
  for (const post of batch) {
    try {
      await generateAndAttachFeaturedImage(post.id, post.title, post.summary, post.slug);
      succeeded++;
    } catch (err) {
      failed++;
      logger.warn('Backfill image generation failed', { postId: post.id, err: String(err) });
    }
  }

  const remaining = totalMissing - succeeded;
  logger.info('Backfill batch complete', { totalMissing, succeeded, failed, remaining });
  return { totalMissing, succeeded, failed, remaining };
}
```

- [ ] **Step 2: Type-check**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/images/backfill.ts
git commit -m "Add featured image backfill service"
```

---

### Task 3: Admin API route

**Files:**
- Create: `src/pages/api/admin/images/backfill.ts`

- [ ] **Step 1: Create the API route**

Create `src/pages/api/admin/images/backfill.ts` (mirrors `src/pages/api/admin/drafts/regenerate.ts`):

```typescript
// API: Backfill featured images for published posts missing a real image

import type { APIRoute } from 'astro';
import { backfillMissingFeaturedImages } from '@/services/images/backfill';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:backfill-images');

export const POST: APIRoute = async ({ redirect }) => {
  logger.info('Backfilling featured images');

  try {
    const r = await backfillMissingFeaturedImages();
    return redirect(
      `/admin/drafts?img_done=${r.succeeded}&img_fail=${r.failed}&img_left=${r.remaining}`,
    );
  } catch (err) {
    logger.error('Image backfill failed', { err: String(err) });
    return new Response(`Image backfill failed: ${String(err)}`, { status: 500 });
  }
};
```

- [ ] **Step 2: Type-check**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/admin/images/backfill.ts
git commit -m "Add admin API route for featured image backfill"
```

---

### Task 4: Backfill button and result banner

**Files:**
- Modify: `src/pages/admin/drafts/index.astro`

- [ ] **Step 1: Read the result query params in the frontmatter**

In `src/pages/admin/drafts/index.astro`, the frontmatter currently is:

```astro
---
import AdminLayout from '@/layouts/AdminLayout.astro';
import { getRecentDrafts } from '@/lib/supabase/queries';

const drafts = await getRecentDrafts(500).catch(() => []);
const regenerated = Astro.url.searchParams.get('regenerated') === '1';
---
```

Change it to:

```astro
---
import AdminLayout from '@/layouts/AdminLayout.astro';
import { getRecentDrafts } from '@/lib/supabase/queries';

const drafts = await getRecentDrafts(500).catch(() => []);
const regenerated = Astro.url.searchParams.get('regenerated') === '1';
const imgDone = Astro.url.searchParams.get('img_done');
const imgFail = Astro.url.searchParams.get('img_fail');
const imgLeft = Astro.url.searchParams.get('img_left');
const showImgResult = imgDone !== null;
---
```

- [ ] **Step 2: Add the result banner and the backfill button**

In `src/pages/admin/drafts/index.astro`, the markup currently opens like this (the regenerate banner followed by the search row):

```astro
<AdminLayout title="下書き履歴" activeNav="drafts">
  {regenerated && (
    <div class="mb-4 px-4 py-2 rounded-md bg-score-highBg text-score-high text-sm">
      記事を再生成し、WordPress本文を更新しました。
    </div>
  )}

  <div class="mb-3 flex items-center gap-3">
```

Insert the image-result banner and the backfill-button row between the regenerate banner and the `<div class="mb-3 flex items-center gap-3">` search row, so it becomes:

```astro
<AdminLayout title="下書き履歴" activeNav="drafts">
  {regenerated && (
    <div class="mb-4 px-4 py-2 rounded-md bg-score-highBg text-score-high text-sm">
      記事を再生成し、WordPress本文を更新しました。
    </div>
  )}

  {showImgResult && (
    <div class="mb-4 px-4 py-2 rounded-md bg-score-highBg text-score-high text-sm">
      画像を {imgDone} 件生成しました（失敗 {imgFail} ／ 残り {imgLeft}）。{Number(imgLeft) > 0 && ' もう一度押すと続きを処理します。'}
    </div>
  )}

  <div class="mb-3">
    <form method="POST" action="/api/admin/images/backfill">
      <button
        type="submit"
        class="text-xs text-accent border border-border rounded px-3 py-1.5 hover:bg-[#F0F0EE] transition-colors"
      >
        画像が無い記事に一括生成（最大10件）
      </button>
    </form>
  </div>

  <div class="mb-3 flex items-center gap-3">
```

(Leave the rest of the file unchanged.)

- [ ] **Step 3: Type-check**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 4: Manual verification in the dev server**

Run: `npm run dev`

Then:
1. Open `http://localhost:4321/admin/drafts` (middleware bypasses auth in DEV).
2. Click "画像が無い記事に一括生成（最大10件）".
3. The page should reload at `/admin/drafts?img_done=...&img_fail=...&img_left=...` and show the green result banner with counts.
4. Confirm in WordPress that the processed posts now have a real featured image (not the placeholder, media id ≠ 125), and the post bodies/URLs are unchanged.

Expected: banner shows counts; processed posts get real featured images; if `img_left > 0`, clicking again processes the next batch.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/drafts/index.astro
git commit -m "Add featured image backfill button and result banner"
```

---

## Notes / Out of Scope

- `/api/admin/*` is not covered by the auth middleware (which only guards `/admin/*`); this follows the existing pattern. The auth gap is a pre-existing issue tracked separately.
- No date-range targeting, no automatic/scheduled batching, no pre-run count on page load — all intentionally out of scope. Detection is purely "published post whose `featured_media` is the placeholder id".
- The per-click cap (`BACKFILL_LIMIT = 10`) bounds Gemini spend; the operator clicks again to process more.
