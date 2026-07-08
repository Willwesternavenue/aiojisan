# Hybrid Image Provider Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route featured-image generation by pillar (physical-ai / generative-ai-news → Nano Banana Pro; ai-driven-development → gpt-image-2) with cross-provider fallback, and surface credit-depletion alerts on the admin dashboard.

**Architecture:** A new `src/services/images/provider.ts` owns model selection, generation, and fallback; `generateAndAttachFeaturedImage` keeps prompt-building and WordPress upload but delegates generation. Quota-type errors are recorded to the (already-applied) `system_alerts` table via `src/services/images/alerts.ts`, and the admin dashboard shows a red banner when alerts exist in the last 7 days.

**Tech Stack:** Astro 6 (SSR), `@google/genai` (gemini-3-pro-image), `openai` v4.77 (gpt-image-2 — installed SDK types already include `'1536x1024'` and `'medium'`; no casts needed), Supabase.

## Global Constraints

- No test framework — verification is `npx astro check` (0 errors) plus the manual checks written into each task. Do not add tests or upgrade dependencies.
- The `system_alerts` table ALREADY EXISTS in production (user applied it, RLS enabled, verified). Task 1 adds the migration file to the repo as a record only — do NOT attempt to run it.
- Default behavior when `pillar` is omitted: primary = Gemini (gemini-3-pro-image), fallback = OpenAI.
- Alert recording must never throw into the image-generation flow.
- Live image generation costs money — no task may actually call Gemini/OpenAI. The live routing/fallback check happens in the post-plan rollout with the user.

---

### Task 1: Alerts module + migration record

**Files:**
- Create: `supabase/migrations/003_system_alerts.sql`
- Create: `src/services/images/alerts.ts`

**Interfaces:**
- Produces: `recordQuotaAlert(source: 'gemini' | 'openai', message: string): Promise<void>` — fire-and-forget-safe (never throws), 6-hour per-source dedup.

- [ ] **Step 1: Create the migration file (repo record of already-applied SQL)**

Create `supabase/migrations/003_system_alerts.sql`:

```sql
-- System alerts surfaced on the admin dashboard (e.g. image-generation
-- credit depletion). NOTE: already applied to production manually.

CREATE TABLE system_alerts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source     TEXT NOT NULL,          -- 'gemini' | 'openai'
  kind       TEXT NOT NULL,          -- 'quota'
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_system_alerts_created_at ON system_alerts(created_at DESC);

-- Server-only table: app reads/writes via service role (bypasses RLS).
-- Enable RLS with no policies so anon/authenticated roles have zero access.
ALTER TABLE system_alerts ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Create the alerts module**

Create `src/services/images/alerts.ts`:

```typescript
// Quota-depletion alerts surfaced on the admin dashboard.

import { getAdminClient } from '@/lib/supabase/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('system-alerts');

const DEDUP_WINDOW_HOURS = 6;

/**
 * Record a quota/credit-depletion alert for the admin dashboard.
 * Deduplicates per source within a 6h window. Never throws — alerting
 * must not break the image-generation flow.
 */
export async function recordQuotaAlert(
  source: 'gemini' | 'openai',
  message: string,
): Promise<void> {
  try {
    const db = getAdminClient();
    const since = new Date(Date.now() - DEDUP_WINDOW_HOURS * 3600_000).toISOString();
    const { data: existing } = await db
      .from('system_alerts')
      .select('id')
      .eq('source', source)
      .gte('created_at', since)
      .limit(1)
      .maybeSingle();
    if (existing) return;

    await db.from('system_alerts').insert({ source, kind: 'quota', message });
    logger.warn('Quota alert recorded', { source });
  } catch (err) {
    logger.warn('Failed to record quota alert', { source, err: String(err) });
  }
}
```

- [ ] **Step 3: Type-check**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/003_system_alerts.sql src/services/images/alerts.ts
git commit -m "Add system_alerts migration record and quota-alert module"
```

---

### Task 2: Image provider module (routing + fallback)

**Files:**
- Create: `src/services/images/provider.ts`

**Interfaces:**
- Consumes: `recordQuotaAlert(source, message)` from `./alerts` (Task 1).
- Produces: `generateFeaturedImageBuffer(prompt: string, pillar?: string): Promise<{ buffer: Buffer; provider: 'gemini' | 'openai'; model: string }>`.

- [ ] **Step 1: Create the provider module**

Create `src/services/images/provider.ts`:

```typescript
// Featured-image generation: pillar-based provider routing with
// cross-provider fallback and quota-depletion alerting.
//
// Routing: ai-driven-development → gpt-image-2 (OpenAI); everything else
// (physical-ai, generative-ai-news, unknown) → gemini-3-pro-image
// ("Nano Banana Pro"). If the primary provider fails, the other one is
// tried once before giving up.

import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { getGoogleAiKey, getOpenAiKey } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { recordQuotaAlert } from './alerts';

const logger = createLogger('image-provider');

const GEMINI_IMAGE_MODEL = 'gemini-3-pro-image';
const OPENAI_IMAGE_MODEL = 'gpt-image-2';

type Provider = 'gemini' | 'openai';

export interface GeneratedImage {
  buffer: Buffer;
  provider: Provider;
  model: string;
}

function isQuotaError(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('insufficient_quota') ||
    msg.includes('credits are depleted')
  );
}

async function generateWithGemini(prompt: string): Promise<Buffer> {
  const ai = new GoogleGenAI({ apiKey: getGoogleAiKey() });
  const res = await ai.models.generateContent({
    model: GEMINI_IMAGE_MODEL,
    contents: prompt,
    config: { responseModalities: ['IMAGE', 'TEXT'] },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = (res as any).candidates?.[0]?.content?.parts ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imgPart = parts.find((p: any) => p.inlineData);
  if (!imgPart?.inlineData?.data) {
    throw new Error(`${GEMINI_IMAGE_MODEL} returned no image data`);
  }
  return Buffer.from(imgPart.inlineData.data, 'base64');
}

async function generateWithOpenAI(prompt: string): Promise<Buffer> {
  const client = new OpenAI({ apiKey: getOpenAiKey() });
  const res = await client.images.generate({
    model: OPENAI_IMAGE_MODEL,
    prompt,
    size: '1536x1024',
    quality: 'medium',
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${OPENAI_IMAGE_MODEL} returned no image data`);
  return Buffer.from(b64, 'base64');
}

export async function generateFeaturedImageBuffer(
  prompt: string,
  pillar?: string,
): Promise<GeneratedImage> {
  const primary: Provider = pillar === 'ai-driven-development' ? 'openai' : 'gemini';
  const secondary: Provider = primary === 'gemini' ? 'openai' : 'gemini';

  let lastError: unknown;
  for (const provider of [primary, secondary]) {
    try {
      const buffer =
        provider === 'gemini'
          ? await generateWithGemini(prompt)
          : await generateWithOpenAI(prompt);
      const model = provider === 'gemini' ? GEMINI_IMAGE_MODEL : OPENAI_IMAGE_MODEL;
      logger.info('Featured image generated', {
        provider,
        model,
        pillar: pillar ?? '(default)',
        fallbackUsed: provider === secondary,
      });
      return { buffer, provider, model };
    } catch (err) {
      lastError = err;
      if (isQuotaError(err)) {
        void recordQuotaAlert(provider, String(err).slice(0, 500));
      }
      if (provider === primary) {
        logger.warn('Primary image provider failed, falling back', {
          provider,
          pillar: pillar ?? '(default)',
          err: String(err).slice(0, 300),
        });
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Image generation failed on both providers: ${String(lastError)}`);
}
```

- [ ] **Step 2: Type-check**

Run: `npx astro check`
Expected: 0 errors. (Installed openai v4.77 types include `'1536x1024'` and `'medium'` — verified. Model accepts arbitrary strings.)

- [ ] **Step 3: Commit**

```bash
git add src/services/images/provider.ts
git commit -m "Add pillar-routed image provider with cross-provider fallback"
```

---

### Task 3: Wire the provider into generation, backfill, and the WP client

**Files:**
- Modify: `src/services/wordpress/client.ts` (imports; `generateAndAttachFeaturedImage`)
- Modify: `src/services/drafts/generate.ts` (one call site)
- Modify: `src/services/images/backfill.ts` (pillar detection; `BACKFILL_LIMIT`)
- Modify: `src/pages/admin/drafts/index.astro` (button label 10→5)

**Interfaces:**
- Consumes: `generateFeaturedImageBuffer(prompt, pillar?)` from `@/services/images/provider` (Task 2); `detectPillarCategories(texts)` from `@/services/editorial/pillars` (existing — returns `PillarCategory[]` whose items have `.slug`).
- Produces: `generateAndAttachFeaturedImage(postId, title, summary, slug, pillar?)` — 5th optional param.

- [ ] **Step 1: Update `src/services/wordpress/client.ts` imports**

The file currently starts with:

```typescript
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import { marked } from 'marked';
import { getEnv, getOpenAiKey, getGoogleAiKey } from '@/lib/env';
import { createLogger } from '@/lib/logger';
```

`OpenAI` and `getOpenAiKey` are pre-existing unused imports (long-standing lint hints), and `GoogleGenAI`/`getGoogleAiKey` become unused once generation moves to the provider. Replace the block with:

```typescript
import { marked } from 'marked';
import { getEnv } from '@/lib/env';
import { generateFeaturedImageBuffer } from '@/services/images/provider';
import { createLogger } from '@/lib/logger';
```

Also DELETE the now-unused module constant (lines near the top):

```typescript
// Featured-image model: Gemini 3.1 Flash Image (Nano Banana 2) — much faster
// and cheaper than the Pro image model (~13s vs ~22s/image).
const IMAGE_MODEL = 'gemini-3.1-flash-image';
```

- [ ] **Step 2: Rework `generateAndAttachFeaturedImage`**

The current function (docstring mentions DALL-E 3 — stale) builds the prompt, calls Gemini inline, then uploads. Replace the docstring, signature, and the generation section (everything from `const ai = new GoogleGenAI(...)` through `const imageBuffer = Buffer.from(...)`) so the function reads:

```typescript
/**
 * Generate a featured image (pillar-routed provider with fallback) and
 * attach it to a WordPress post. Only called for auto-published articles.
 */
export async function generateAndAttachFeaturedImage(
  postId: number,
  title: string,
  summary: string,
  slug: string,
  pillar?: string,
): Promise<void> {
  logger.info('Generating featured image', { postId, slug, pillar });

  const imagePrompt =
    `テックブログのヘッダー画像を生成してください。` +
    `テーマ：「${title}」。` +
    `補足：${summary.slice(0, 150)}。` +
    `スタイル：明るい配色のフラットイラスト、白い背景、モダンなテクノロジーモチーフ。日本語テキスト使用可。顔なし、ロゴなし。`;

  const { buffer: imageBuffer, provider, model } = await generateFeaturedImageBuffer(
    imagePrompt,
    pillar,
  );
  logger.info('Image generated', { postId, provider, model });
```

Everything from `// Upload to WordPress media library` onward (filename, media upload, attach, final log) stays EXACTLY as it is — it already consumes `imageBuffer`.

- [ ] **Step 3: Pass the pillar in `src/services/drafts/generate.ts`**

Current call (inside the `if (autoPublish)` block):

```typescript
      await generateAndAttachFeaturedImage(
        wpPostId,
        selectedTitle,
        insights?.short_summary ?? '',
        draft.slug,
      );
```

Change to:

```typescript
      await generateAndAttachFeaturedImage(
        wpPostId,
        selectedTitle,
        insights?.short_summary ?? '',
        draft.slug,
        pillarCategories[0]?.slug,
      );
```

(`pillarCategories` is already computed earlier in the function.)

- [ ] **Step 4: Pillar detection + batch limit in `src/services/images/backfill.ts`**

(a) Add the import:

```typescript
import { detectPillarCategories } from '@/services/editorial/pillars';
```

(b) Replace the limit constant and its comment. Current:

```typescript
// Gemini 3.1 Flash Image takes ~13s; 10 × ~13s ≈ 130s stays comfortably under
// the 300s function ceiling so the request always completes and redirects.
const BACKFILL_LIMIT = 10;
```

New:

```typescript
// Nano Banana Pro takes ~21s and gpt-image-2 ~54s per image; 5 per batch
// (~250s worst normal case) stays under the 300s function ceiling. A
// full-fallback batch could exceed it, but attached images persist and the
// operator just clicks again (idempotent).
const BACKFILL_LIMIT = 5;
```

(c) In the loop, pass the detected pillar. Current:

```typescript
  for (const post of batch) {
    try {
      await generateAndAttachFeaturedImage(post.id, post.title, post.summary, post.slug);
      succeeded++;
```

New:

```typescript
  for (const post of batch) {
    try {
      const pillar = detectPillarCategories([post.title, post.summary])[0]?.slug;
      await generateAndAttachFeaturedImage(post.id, post.title, post.summary, post.slug, pillar);
      succeeded++;
```

- [ ] **Step 5: Update the backfill button label in `src/pages/admin/drafts/index.astro`**

Change:

```astro
        画像が無い記事に一括生成（最大10件）
```

to:

```astro
        画像が無い記事に一括生成（最大5件）
```

- [ ] **Step 6: Type-check**

Run: `npx astro check`
Expected: 0 errors, and the two long-standing unused-import hints in `client.ts` (`OpenAI`, `getOpenAiKey`) are gone.

- [ ] **Step 7: Commit**

```bash
git add src/services/wordpress/client.ts src/services/drafts/generate.ts src/services/images/backfill.ts src/pages/admin/drafts/index.astro
git commit -m "Route featured images by pillar with provider fallback"
```

---

### Task 4: Dashboard quota-alert banner

**Files:**
- Modify: `src/pages/admin/index.astro`

**Interfaces:**
- Consumes: the `system_alerts` table (Task 1 schema) via the page's existing `db` (`getAdminClient()`), already imported.

- [ ] **Step 1: Fetch recent alerts in the frontmatter**

In `src/pages/admin/index.astro`, after the existing `recentRuns` block (which ends with `const recentRuns = (recentRunsRaw ?? []) as RunRow[];`), add:

```typescript
// Quota alerts (last 7 days) — surfaced when image-generation credits run out
type AlertRow = { source: string; message: string; created_at: string };
let quotaAlerts: AlertRow[] = [];
try {
  const { data } = await db
    .from('system_alerts')
    .select('source, message, created_at')
    .gte('created_at', new Date(Date.now() - 7 * 24 * 3600_000).toISOString())
    .order('created_at', { ascending: false })
    .limit(5);
  quotaAlerts = (data ?? []) as AlertRow[];
} catch {
  quotaAlerts = [];
}
```

- [ ] **Step 2: Render the banner**

Immediately after the opening `<AdminLayout title="ダッシュボード" activeNav="dashboard">` tag (before the `<!-- Stats row -->` comment), insert:

```astro
  {quotaAlerts.length > 0 && (
    <div class="mb-6 px-4 py-3 rounded-md bg-red-50 border border-red-200 text-sm text-red-700">
      <p class="font-semibold mb-1">⚠️ 画像生成のクレジット枯渇を検知しました</p>
      {quotaAlerts.map(a => (
        <p class="text-xs">
          {a.source === 'gemini' ? 'Gemini（AI Studio）' : 'OpenAI'}
          ・{new Date(a.created_at).toLocaleString('ja-JP')} — 残高を確認してください
        </p>
      ))}
    </div>
  )}
```

(Standard Tailwind palette classes like `bg-blue-50` are already used elsewhere in the admin, so `bg-red-50`/`border-red-200`/`text-red-700` resolve.)

- [ ] **Step 3: Type-check**

Run: `npx astro check`
Expected: 0 errors.

- [ ] **Step 4: Manual banner verification in dev (no image generation)**

Insert a test alert row, view the dashboard, then remove the row:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = readFileSync('./.env','utf8');
const get = k => (env.match(new RegExp('^'+k+'\\\\s*=\\\\s*\"?([^\"\\\\n]+)\"?','m'))||[])[1]?.trim();
const db = createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), { auth:{persistSession:false} });
const { error } = await db.from('system_alerts').insert({ source:'gemini', kind:'quota', message:'test banner row' });
console.log(error ? 'ERR '+error.message : 'inserted');
"
```

Then load `http://localhost:4321/admin` in the dev server (middleware bypasses auth in DEV) and confirm the red banner shows 「⚠️ 画像生成のクレジット枯渇を検知しました」 with a Gemini line. Afterwards clean up:

```bash
node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = readFileSync('./.env','utf8');
const get = k => (env.match(new RegExp('^'+k+'\\\\s*=\\\\s*\"?([^\"\\\\n]+)\"?','m'))||[])[1]?.trim();
const db = createClient(get('SUPABASE_URL'), get('SUPABASE_SERVICE_ROLE_KEY'), { auth:{persistSession:false} });
const { error } = await db.from('system_alerts').delete().eq('message','test banner row');
console.log(error ? 'ERR '+error.message : 'cleaned');
"
```

Reload the dashboard and confirm the banner is gone.

- [ ] **Step 5: Commit**

```bash
git add src/pages/admin/index.astro
git commit -m "Show quota-depletion alert banner on admin dashboard"
```

---

## Rollout (after all tasks; with the user)

1. Merge to main, push, wait for Vercel deploy.
2. Live routing check (costs ~2 images): run a one-off local script calling `generateFeaturedImageBuffer` is not possible post-build — instead, verify in production organically: the next auto-published article logs `Featured image generated { provider, model, pillar }` in Vercel logs, and/or click the backfill button once and confirm mixed providers appear for differently-pillared posts.
3. Fallback path and alert banner get exercised naturally on the next real quota event; the banner was already verified in dev (Task 4).

## Notes / Out of Scope

- Retry-count configuration, a third provider, per-model prompt variants, alert read/resolve flow — all out of scope per the spec.
- The `system_alerts` migration is already applied and verified in production (service-role access OK; anon blocked by RLS).
