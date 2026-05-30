# Regenerate Existing Articles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a one-click "再生成" button in the admin drafts list that rewrites an existing article's body with the current Claude prompt and overwrites the same WordPress post in place (URL/slug/title unchanged).

**Architecture:** Extract the AI draft-generation step shared by `generateDraftForArticle` into a helper (`content.ts`). A new `regenerateDraftForArticle` service reuses that helper but routes to `updateWordPressDraft` (update existing post) instead of `createWordPressDraft`. An admin API route mirrors the existing `generate-draft.ts` pattern; the drafts list page gets a form button per row.

**Tech Stack:** Astro 6 (SSR), Supabase JS, Anthropic SDK (via existing AI provider), WordPress REST. No test framework exists in this repo — verification is `npx astro check` (types) plus a manual dev-server check.

---

### Task 1: Extract shared draft-content helper and refactor generate.ts

**Files:**
- Create: `src/services/drafts/content.ts`
- Modify: `src/services/drafts/generate.ts` (imports + the inline generate block ~lines 1-13, 82-100, 193)

- [ ] **Step 1: Create the shared helper**

Create `src/services/drafts/content.ts`:

```typescript
// Shared blog-draft content generation (used by generate and regenerate)

import { getAiProvider } from '@/services/ai';
import { getStyleChunksForDraft } from '@/services/rag/retrieval';
import type { BlogDraftOutput } from '@/types/ai';

export interface ArticleForDraft {
  title: string;
  canonical_url: string;
  extracted_text: string | null;
  article_ai_insights: {
    short_summary: string | null;
    long_summary: string | null;
    topics: string[] | null;
  } | null;
}

/**
 * Run the AI draft generation step for an article (fetch style chunks + call
 * the blog-draft model). Returns the generated draft and how many style chunks
 * were used so callers can record it in metadata.
 */
export async function buildBlogDraftForArticle(
  article: ArticleForDraft,
): Promise<{ draft: BlogDraftOutput; styleChunksUsed: number }> {
  const ai = getAiProvider();
  const insights = article.article_ai_insights;
  const styleChunks = await getStyleChunksForDraft(article.title, insights?.topics ?? []);
  const draft = await ai.generateBlogDraft({
    articleTitle: article.title,
    articleUrl: article.canonical_url,
    articleText: article.extracted_text ?? '',
    shortSummary: insights?.short_summary ?? '',
    longSummary: insights?.long_summary ?? '',
    topics: insights?.topics ?? [],
    styleChunks,
  });
  return { draft, styleChunksUsed: styleChunks.length };
}
```

- [ ] **Step 2: Refactor `generate.ts` imports**

In `src/services/drafts/generate.ts`, remove the now-unused `getStyleChunksForDraft` import and add the helper import. Change the top import block:

```typescript
// Shared draft generation logic (used by API route and cron)

import { getAdminClient } from '@/lib/supabase/server';
import { getAiProvider } from '@/services/ai';
import {
  createWordPressDraft,
  generateAndAttachFeaturedImage,
  getOrCreateWordPressCategory,
} from '@/services/wordpress/client';
import { postToX } from '@/services/social/x';
import { detectPillarCategories, type PillarCategory } from '@/services/editorial/pillars';
import { buildBlogDraftForArticle } from './content';
import { createLogger } from '@/lib/logger';
```

(`getAiProvider` stays — it is still used for `ai.generateXPosts` later in the file.)

- [ ] **Step 3: Replace the inline generation block**

In `src/services/drafts/generate.ts`, find this block (currently around lines 82-100):

```typescript
  const insights = article.article_ai_insights;
  const { autoPublish = false } = options;

  logger.info('Generating draft', { articleId, title: article.title, autoPublish });

  const styleChunks = await getStyleChunksForDraft(
    article.title,
    insights?.topics ?? [],
  );

  const draft = await ai.generateBlogDraft({
    articleTitle: article.title,
    articleUrl: article.canonical_url,
    articleText: article.extracted_text ?? '',
    shortSummary: insights?.short_summary ?? '',
    longSummary: insights?.long_summary ?? '',
    topics: insights?.topics ?? [],
    styleChunks,
  });
```

Replace it with:

```typescript
  const insights = article.article_ai_insights;
  const { autoPublish = false } = options;

  logger.info('Generating draft', { articleId, title: article.title, autoPublish });

  const { draft, styleChunksUsed } = await buildBlogDraftForArticle(article);
```

- [ ] **Step 4: Update the metadata field that referenced `styleChunks.length`**

In `src/services/drafts/generate.ts`, in the `generated_drafts` insert's `generation_metadata` (currently around line 193), change:

```typescript
      styleChunksUsed: styleChunks.length,
```

to:

```typescript
      styleChunksUsed,
```

- [ ] **Step 5: Type-check**

Run: `npx astro check`
Expected: 0 errors (the file compiles; `ai` is still used by `generateXPosts`, `styleChunksUsed` is defined, `getStyleChunksForDraft` is no longer referenced in generate.ts).

- [ ] **Step 6: Commit**

```bash
git add src/services/drafts/content.ts src/services/drafts/generate.ts
git commit -m "Extract shared blog-draft generation helper"
```

---

### Task 2: Add the regeneration service

**Files:**
- Create: `src/services/drafts/regenerate.ts`

- [ ] **Step 1: Create the regeneration service**

Create `src/services/drafts/regenerate.ts`:

```typescript
// Regenerate an existing article's body with the current prompt and overwrite
// the same WordPress post in place (URL / slug / title unchanged).

import { getAdminClient } from '@/lib/supabase/server';
import { updateWordPressDraft } from '@/services/wordpress/client';
import { buildBlogDraftForArticle } from './content';
import { createLogger } from '@/lib/logger';

const logger = createLogger('draft-regenerator');

export async function regenerateDraftForArticle(
  articleId: string,
): Promise<{ wpPostId: number }> {
  const db = getAdminClient();

  // 1. Most recent stored draft for this article (gives us the WP post + title)
  const { data: draftRow, error: draftErr } = await db
    .from('generated_drafts')
    .select('id, draft_title, wordpress_post_id')
    .eq('article_id', articleId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (draftErr || !draftRow) {
    throw new Error(`No existing draft found for article ${articleId}`);
  }
  if (!draftRow.wordpress_post_id) {
    throw new Error(`Draft for article ${articleId} has no WordPress post to update`);
  }

  // 2. Article + insights
  const { data: article, error: articleErr } = await db
    .from('articles')
    .select('*, article_ai_insights(*)')
    .eq('id', articleId)
    .single();

  if (articleErr || !article) {
    throw new Error(`Article ${articleId} not found`);
  }

  logger.info('Regenerating draft', { articleId, wpPostId: draftRow.wordpress_post_id });

  // 3. Fresh content via the shared helper
  const { draft, styleChunksUsed } = await buildBlogDraftForArticle(article);

  // 4. Overwrite WordPress body, keeping the existing title (slug stays untouched)
  await updateWordPressDraft(draftRow.wordpress_post_id, draftRow.draft_title, draft.body);

  // 5. Update the stored draft row
  await db
    .from('generated_drafts')
    .update({
      draft_body: draft.body,
      draft_outline: draft.outline,
      generation_metadata: {
        styleChunksUsed,
        model: draft.model,
        regenerated: true,
        regenerated_at: new Date().toISOString(),
      },
    })
    .eq('id', draftRow.id);

  // 6. Record the action
  await db.from('article_actions').insert({
    article_id: articleId,
    action_type: 'regenerate_blog_draft',
  });

  logger.info('Draft regenerated', { articleId, wpPostId: draftRow.wordpress_post_id });
  return { wpPostId: draftRow.wordpress_post_id };
}
```

- [ ] **Step 2: Type-check**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/services/drafts/regenerate.ts
git commit -m "Add regenerateDraftForArticle service"
```

---

### Task 3: Add the admin API route

**Files:**
- Create: `src/pages/api/admin/drafts/regenerate.ts`

- [ ] **Step 1: Create the API route**

Create `src/pages/api/admin/drafts/regenerate.ts` (mirrors `src/pages/api/admin/articles/generate-draft.ts`):

```typescript
// API: Regenerate the body of an existing article and overwrite its WP post

import type { APIRoute } from 'astro';
import { regenerateDraftForArticle } from '@/services/drafts/regenerate';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:regenerate-draft');

export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();
  const articleId = formData.get('article_id') as string;

  if (!articleId) {
    return new Response('Missing article_id', { status: 400 });
  }

  logger.info('Regenerating draft', { articleId });

  try {
    await regenerateDraftForArticle(articleId);
    return redirect('/admin/drafts?regenerated=1');
  } catch (err) {
    logger.error('Draft regeneration failed', { articleId, err: String(err) });
    return new Response(`Draft regeneration failed: ${String(err)}`, { status: 500 });
  }
};
```

- [ ] **Step 2: Type-check**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/api/admin/drafts/regenerate.ts
git commit -m "Add admin API route for draft regeneration"
```

---

### Task 4: Add the regenerate button and success banner to the drafts list

**Files:**
- Modify: `src/pages/admin/drafts/index.astro`

- [ ] **Step 1: Read the `regenerated` query param at the top of the page**

In `src/pages/admin/drafts/index.astro`, change the frontmatter (top `---` block) from:

```astro
---
import AdminLayout from '@/layouts/AdminLayout.astro';
import { getRecentDrafts } from '@/lib/supabase/queries';

const drafts = await getRecentDrafts(30).catch(() => []);
---
```

to:

```astro
---
import AdminLayout from '@/layouts/AdminLayout.astro';
import { getRecentDrafts } from '@/lib/supabase/queries';

const drafts = await getRecentDrafts(30).catch(() => []);
const regenerated = Astro.url.searchParams.get('regenerated') === '1';
---
```

- [ ] **Step 2: Add the success banner above the list**

In `src/pages/admin/drafts/index.astro`, immediately after the opening `<AdminLayout ...>` tag, insert the banner:

```astro
<AdminLayout title="下書き履歴" activeNav="drafts">
  {regenerated && (
    <div class="mb-4 px-4 py-2 rounded-md bg-score-highBg text-score-high text-sm">
      記事を再生成し、WordPress本文を更新しました。
    </div>
  )}
  <div class="bg-surface border border-border rounded-md divide-y divide-border">
```

(This replaces the existing `<AdminLayout title="下書き履歴" activeNav="drafts">` + `<div class="bg-surface ...">` opening lines by inserting the banner block between them.)

- [ ] **Step 3: Add the regenerate button in the per-row actions**

In `src/pages/admin/drafts/index.astro`, the per-row action area currently ends with the "WPで開く" link inside `<div class="flex items-center gap-2 flex-shrink-0">`. Add a regenerate form for rows that have a `wordpress_post_id`. Replace this block:

```astro
          {draft.wordpress_post_id && (
            <a
              href={`${import.meta.env.WORDPRESS_BASE_URL}/wp-admin/post.php?post=${draft.wordpress_post_id}&action=edit`}
              target="_blank" rel="noopener noreferrer"
              class="text-xs text-text-secondary hover:text-text-primary border border-border rounded px-2 py-0.5 hover:bg-[#F0F0EE] transition-colors"
            >
              WPで開く ↗
            </a>
          )}
```

with:

```astro
          {draft.wordpress_post_id && (
            <a
              href={`${import.meta.env.WORDPRESS_BASE_URL}/wp-admin/post.php?post=${draft.wordpress_post_id}&action=edit`}
              target="_blank" rel="noopener noreferrer"
              class="text-xs text-text-secondary hover:text-text-primary border border-border rounded px-2 py-0.5 hover:bg-[#F0F0EE] transition-colors"
            >
              WPで開く ↗
            </a>
          )}
          {draft.wordpress_post_id && draft.article_id && (
            <form method="POST" action="/api/admin/drafts/regenerate">
              <input type="hidden" name="article_id" value={draft.article_id} />
              <button
                type="submit"
                class="text-xs text-accent border border-border rounded px-2 py-0.5 hover:bg-[#F0F0EE] transition-colors"
              >
                再生成
              </button>
            </form>
          )}
```

- [ ] **Step 4: Type-check**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 5: Manual verification in the dev server**

Run: `npm run dev`

Then:
1. Open `http://localhost:4321/admin/drafts` (middleware bypasses auth in DEV).
2. Pick a row that shows the WordPress post link, note its current body in WordPress (post ID + slug).
3. Click "再生成". The page should reload at `/admin/drafts?regenerated=1` and show the green success banner.
4. Confirm in WordPress that the same post (unchanged post ID and slug) now has a longer, regenerated body, and the title is unchanged.

Expected: banner appears; WordPress body updated in place; URL/slug/title unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/pages/admin/drafts/index.astro
git commit -m "Add regenerate button and success banner to drafts list"
```

---

## Notes / Out of Scope

- `/api/admin/*` is not covered by the auth middleware (which only guards `/admin/*`). This task follows the existing pattern; the auth gap is a pre-existing issue to address separately.
- No diff-preview, no bulk/automatic regeneration, no detection of human edits (manual selection puts the decision with the operator), no title/slug regeneration — all intentionally out of scope.
