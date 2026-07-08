# Daily-Floor Publish Guarantee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When no article has been published for 24 hours, the hourly cron publishes the single best unpublished candidate (overall_score ≥ 8.0) from the last 48 hours — guaranteeing ~1 article/day without touching the normal 8.5 threshold.

**Architecture:** One new function `publishDailyFloorCandidate(db, publishStats)` in `src/pages/api/cron/process-articles.ts`, called at the end of the handler (after carryover + the new-article batch, so a same-run publish naturally suppresses it via the latest-published-row check). Candidate selection mirrors `publishCarryoverCandidates` exactly (same select/normalization/exclusion/sort), differing only in the score floor (8.0 vs 8.5) and taking just the top 1, published via the existing `publishArticle` path.

**Tech Stack:** Astro 6 SSR cron route, Supabase. No new dependencies.

## Global Constraints

- No test framework — verification is `npx astro check` (0 errors). Do not add tests.
- Normal publishing is UNCHANGED: `AUTO_PUBLISH_THRESHOLD = 8.5`, `EXCEPTIONAL_PUBLISH_THRESHOLD = 9.2`, `DAILY_AUTO_PUBLISH_TARGET = 5`, `DAILY_PHYSICAL_AI_TARGET = 2` stay as-is.
- Floor values: drought window 24h; candidate score floor 8.0; candidate recency window = existing `CARRYOVER_LOOKBACK_HOURS` (48h, on `articles.created_at`, mirroring carryover; scoring lags fetch by at most hours so this matches the spec's "scored within 48h" intent).
- A floor-publish failure must only warn — the cron response stays `ok: true`.

---

### Task 1: Add the daily-floor publish to process-articles

**Files:**
- Modify: `src/pages/api/cron/process-articles.ts`

**Interfaces:**
- Consumes (all already in the file): `publishArticle(articleId, scores, pillarCategories, publishStats, context)`, `getPillarCategories`, `getCarryoverCutoff()`, `CARRYOVER_CANDIDATE_LIMIT`, `getAdminClient`, `logger`.
- Produces: `publishDailyFloorCandidate(db, publishStats): Promise<{ published: number }>`; handler result JSON gains a `dailyFloor` field.

- [ ] **Step 1: Add the floor constants**

Below the existing constant block (which ends with `const CARRYOVER_CANDIDATE_LIMIT      = 50;`), add:

```typescript
const FLOOR_PUBLISH_THRESHOLD        = 8.0;
const FLOOR_DROUGHT_HOURS            = 24;
```

- [ ] **Step 2: Widen the publish context union**

`publishArticle`'s signature currently has:
```typescript
  context: 'carryover' | 'new',
```
Change to:
```typescript
  context: 'carryover' | 'new' | 'daily-floor',
```

- [ ] **Step 3: Add `publishDailyFloorCandidate` after `publishCarryoverCandidates`**

Insert this function immediately after the closing brace of `publishCarryoverCandidates` (before `async function handler`):

```typescript
// Daily floor: if nothing has published for 24h, publish the single best
// unpublished candidate (>= 8.0) from the carryover window so the site
// never goes a full day without a new article. Quality floor is 8.0 —
// if nothing reaches it, we publish nothing.
async function publishDailyFloorCandidate(
  db: ReturnType<typeof getAdminClient>,
  publishStats: PublishStats,
): Promise<{ published: number }> {
  const { data: lastPublished, error: lastErr } = await db
    .from('generated_drafts')
    .select('created_at')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (lastErr) {
    logger.warn('Daily floor: failed to check last publish time', { error: lastErr.message });
    return { published: 0 };
  }

  const droughtCutoff = Date.now() - FLOOR_DROUGHT_HOURS * 60 * 60 * 1000;
  if (lastPublished && new Date(lastPublished.created_at).getTime() > droughtCutoff) {
    return { published: 0 };
  }

  const { data, error } = await db
    .from('articles')
    .select(`
      id,
      title,
      canonical_url,
      created_at,
      published_at,
      sources(name),
      article_ai_insights(
        short_summary,
        long_summary,
        tags,
        topics,
        overall_score,
        blog_post_potential_score
      ),
      article_actions(action_type),
      generated_drafts(id)
    `)
    .gte('created_at', getCarryoverCutoff())
    .order('published_at', { ascending: false })
    .limit(CARRYOVER_CANDIDATE_LIMIT);

  if (error) {
    logger.warn('Daily floor: failed to fetch candidates', { error: error.message });
    return { published: 0 };
  }

  const candidates = (data ?? [])
    .filter((article: any) => {
      const insights = Array.isArray(article.article_ai_insights)
        ? article.article_ai_insights[0]
        : article.article_ai_insights;
      const actions = Array.isArray(article.article_actions) ? article.article_actions : [];
      const alreadyDrafted = actions.some((action: any) => action.action_type === 'generate_blog_draft');
      const hasDraft = Array.isArray(article.generated_drafts)
        ? article.generated_drafts.length > 0
        : Boolean(article.generated_drafts);
      return Number(insights?.overall_score ?? 0) >= FLOOR_PUBLISH_THRESHOLD && !alreadyDrafted && !hasDraft;
    })
    .sort((a: any, b: any) => {
      const insightA = Array.isArray(a.article_ai_insights) ? a.article_ai_insights[0] : a.article_ai_insights;
      const insightB = Array.isArray(b.article_ai_insights) ? b.article_ai_insights[0] : b.article_ai_insights;
      const overallDiff = Number(insightB?.overall_score ?? 0) - Number(insightA?.overall_score ?? 0);
      if (overallDiff !== 0) return overallDiff;

      const blogDiff =
        Number(insightB?.blog_post_potential_score ?? 0) -
        Number(insightA?.blog_post_potential_score ?? 0);
      if (blogDiff !== 0) return blogDiff;

      return new Date(b.published_at ?? 0).getTime() - new Date(a.published_at ?? 0).getTime();
    });

  const article = candidates[0];
  if (!article) {
    logger.info('Daily floor: drought detected but no candidate >= floor', {
      floor: FLOOR_PUBLISH_THRESHOLD,
    });
    return { published: 0 };
  }

  const insights = Array.isArray(article.article_ai_insights)
    ? article.article_ai_insights[0]
    : article.article_ai_insights;
  const sourceName = (article.sources as unknown as { name: string } | null)?.name ?? 'Unknown';
  const scores = {
    overallScore: Number(insights?.overall_score ?? 0),
    blogPostPotentialScore: insights?.blog_post_potential_score,
  };
  const pillarCategories = getPillarCategories([
    article.title,
    article.canonical_url,
    sourceName,
    insights?.short_summary,
    insights?.long_summary,
    ...(insights?.topics ?? []),
    ...(insights?.tags ?? []),
  ]);

  logger.info('Daily floor publish', {
    articleId: article.id,
    score: scores.overallScore,
    droughtHours: FLOOR_DROUGHT_HOURS,
    pillarCategories: pillarCategories.map(category => category.slug),
  });

  try {
    const didPublish = await publishArticle(article.id, scores, pillarCategories, publishStats, 'daily-floor');
    return { published: didPublish ? 1 : 0 };
  } catch (err) {
    logger.warn('Daily floor publish failed', { articleId: article.id, err: String(err) });
    return { published: 0 };
  }
}
```

- [ ] **Step 4: Call it at the end of the handler**

The handler currently ends with:
```typescript
  const result = { ok: true, processed, failed, total: (articles ?? []).length, carryover, publishStats };
  logger.info('Cron process-articles complete', result);
```
Change to:
```typescript
  const dailyFloor = await publishDailyFloorCandidate(db, publishStats);

  const result = { ok: true, processed, failed, total: (articles ?? []).length, carryover, dailyFloor, publishStats };
  logger.info('Cron process-articles complete', result);
```
(Because the floor re-checks the latest `status='published'` row, a publish earlier in this same run — carryover or new — makes it skip automatically.)

- [ ] **Step 5: Type-check**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/api/cron/process-articles.ts
git commit -m "Publish best >=8.0 candidate when nothing has published for 24h"
```

---

## Rollout (after merge; with the user)

1. Merge to main, push, wait for Vercel deploy.
2. The drought condition is CURRENTLY true (no publish since ~July 7) and 8.4-scored candidates exist in the window — so the next hourly process-articles run should floor-publish exactly 1 article. Verify via Vercel logs (`Daily floor publish`) and the new article on the site (score 8.0-8.4, normal image + X post).
3. Confirm the following runs do NOT floor-publish again (24h self-pacing).

## Notes / Out of Scope

- No threshold change, no configurability, no time-of-day gating, no admin surfacing (per spec).
- The floor intentionally bypasses `getPublishDecision` — it publishes exactly one best candidate regardless of daily-balance counters (which are all zero in a drought anyway).
