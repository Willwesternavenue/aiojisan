# Overseas AI Business Pillar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 4th editorial pillar 「海外AIビジネス」 (`overseas-ai-business`) across detection, scoring, display, hashtags, and daily-balance code; add a content-driven 「スタートアップ解剖」 series instruction to the draft prompt; and add 4 verified RSS sources via an idempotent script.

**Architecture:** The pillar is inserted 3rd in `PILLAR_CATEGORIES` (detection order; before the `generative-ai-news` fallback). Public pages stop duplicating display copy and import a shared `EDITORIAL_DISPLAY_CATEGORIES` from pillars.ts. The scoring prompt moves from 3本柱 to 4本柱 (this is what lets new-pillar articles clear the 8.5 auto-publish threshold instead of being capped at 7.4). Sources are data, inserted once by a dry-run/execute script.

**Tech Stack:** Astro 6 (SSR), Supabase, existing keyword-matching pillar detection. No new dependencies.

## Global Constraints

- No test framework — verification is `npx astro check` (0 errors) plus the manual checks written into each task. Do not add tests.
- Image routing (`provider.ts`) and daily quotas (`DAILY_AUTO_PUBLISH_TARGET = 5`, `DAILY_PHYSICAL_AI_TARGET = 2`) are NOT changed — no new per-pillar quota, no new image-model mapping (the new pillar falls through to the Gemini default by design).
- The source-insert script must be idempotent (skip when the same `list_url` already exists) and must NOT be executed during the tasks — creation + dry-run only; the real run happens in Rollout with the user.
- Slug is exactly `overseas-ai-business`; display label exactly `海外AIビジネス`; hashtag exactly `#AIビジネス`.

---

### Task 1: Add the pillar to pillars.ts (detection + shared display list)

**Files:**
- Modify: `src/services/editorial/pillars.ts`

**Interfaces:**
- Produces: `PillarSlug` union gains `'overseas-ai-business'`; new export `EDITORIAL_DISPLAY_CATEGORIES: EditorialDisplayCategory[]` where `EditorialDisplayCategory = { slug: PillarSlug; label: string; description: string }` (consumed by Task 2). `detectPillarCategories` behavior: unchanged for existing pillars; fallback stays generative-ai-news.

- [ ] **Step 1: Extend the slug union**

Current first line:
```typescript
export type PillarSlug = 'physical-ai' | 'ai-driven-development' | 'generative-ai-news';
```
Change to:
```typescript
export type PillarSlug = 'physical-ai' | 'ai-driven-development' | 'overseas-ai-business' | 'generative-ai-news';
```

- [ ] **Step 2: Insert the 4th pillar entry as the 3rd element**

In `PILLAR_CATEGORIES`, insert the following object BETWEEN the `ai-driven-development` entry and the `generative-ai-news` entry:

```typescript
  {
    name: '海外AIビジネス',
    slug: 'overseas-ai-business',
    description: '海外AI企業・スタートアップの収益モデル、資金調達、M&A、市場構造に関する記事',
    keywords: [
      '資金調達',
      'funding',
      'raises',
      'series a',
      'series b',
      'series c',
      'valuation',
      '評価額',
      'ipo',
      'm&a',
      '買収',
      'acquisition',
      'startup',
      'スタートアップ',
      'y combinator',
      'vc',
      'venture capital',
      'ベンチャーキャピタル',
      'ビジネスモデル',
      '収益モデル',
      'arr',
      'unicorn',
      'ユニコーン',
      'crunchbase',
    ],
  },
```

- [ ] **Step 3: Fix the fallback index (CRITICAL — silent behavior change otherwise)**

`detectPillarCategories` currently ends with:
```typescript
  return matched.length > 0
    ? matched
    : [PILLAR_CATEGORIES[2]];
```
After the insertion, index 2 is the NEW pillar, not generative-ai-news. Replace with a slug lookup so the fallback stays generative-ai-news regardless of order:
```typescript
  return matched.length > 0
    ? matched
    : [PILLAR_CATEGORIES.find(category => category.slug === 'generative-ai-news')!];
```

- [ ] **Step 4: Add the shared display list at the end of the file**

Append after `includesPhysicalAi`:

```typescript
// Display copy for the public pages (order = display order; intentionally
// different from the detection order of PILLAR_CATEGORIES above).
export type EditorialDisplayCategory = {
  slug: PillarSlug;
  label: string;
  description: string;
};

export const EDITORIAL_DISPLAY_CATEGORIES: EditorialDisplayCategory[] = [
  {
    slug: 'generative-ai-news',
    label: '生成AIニュース',
    description: 'モデル、プロダクト、研究、企業導入、政策などAI全般の動き',
  },
  {
    slug: 'ai-driven-development',
    label: 'AI駆動開発',
    description: 'コーディングエージェント、開発プロセス、DevOps、PM/QA',
  },
  {
    slug: 'physical-ai',
    label: 'フィジカルAI',
    description: 'ロボット、ヒューマノイド、自動運転、製造・物流現場のAI',
  },
  {
    slug: 'overseas-ai-business',
    label: '海外AIビジネス',
    description: '海外AI企業の収益モデル、資金調達、スタートアップの勝ち筋',
  },
];
```

- [ ] **Step 5: Type-check**

Run: `npx astro check`
Expected: 1 error is possible at this point ONLY if some `Record<PillarSlug, number>` exists — and it does: `src/pages/api/cron/process-articles.ts` initializes `byPillar` with 3 keys. If the check reports that file missing `'overseas-ai-business'`, that is EXPECTED here and fixed in Task 3. Any other error is a real problem. (If astro check reports 0 errors, that's also acceptable — the Record init uses an object literal that may still satisfy the type.)

- [ ] **Step 6: Commit**

```bash
git add src/services/editorial/pillars.ts
git commit -m "Add overseas-ai-business pillar with shared display categories"
```

---

### Task 2: Public pages use the shared display list

**Files:**
- Modify: `src/pages/index.astro` (lines ~4-20)
- Modify: `src/pages/articles/index.astro` (lines ~4-20)

**Interfaces:**
- Consumes: `EDITORIAL_DISPLAY_CATEGORIES` from `@/services/editorial/pillars` (Task 1).

- [ ] **Step 1: Home page (`src/pages/index.astro`)**

Current frontmatter opens:
```astro
---
import PublicLayout from '@/layouts/PublicLayout.astro';

const EDITORIAL_CATEGORIES = [
  {
    slug: 'generative-ai-news',
    label: '生成AIニュース',
    description: 'モデル、プロダクト、研究、企業導入、政策などAI全般の動き',
  },
  {
    slug: 'ai-driven-development',
    label: 'AI駆動開発',
    description: 'コーディングエージェント、開発プロセス、DevOps、PM/QA',
  },
  {
    slug: 'physical-ai',
    label: 'フィジカルAI',
    description: 'ロボット、ヒューマノイド、自動運転、製造・物流現場のAI',
  },
] as const;
```
Replace the whole block (import + const) with:
```astro
---
import PublicLayout from '@/layouts/PublicLayout.astro';
import { EDITORIAL_DISPLAY_CATEGORIES as EDITORIAL_CATEGORIES } from '@/services/editorial/pillars';
```
Leave the following line (`type EditorialCategory = (typeof EDITORIAL_CATEGORIES)[number];`) and all other usages unchanged — the element type resolves to `EditorialDisplayCategory` and all `.slug`/`.label`/`.description` accesses still type-check.

- [ ] **Step 2: Articles list (`src/pages/articles/index.astro`)**

Current frontmatter opens:
```astro
---
import PublicLayout from '@/layouts/PublicLayout.astro';

const EDITORIAL_CATEGORIES = [
  {
    slug: 'generative-ai-news',
    label: '生成AIニュース',
    description: 'モデル、プロダクト、研究、企業導入、政策などAI全般の動き',
  },
  {
    slug: 'ai-driven-development',
    label: 'AI駆動開発',
    description: 'コーディングエージェント、開発プロセス、DevOps、PM/QA',
  },
  {
    slug: 'physical-ai',
    label: 'フィジカルAI',
    description: 'ロボット、ヒューマノイド、自動運転、製造・物流現場のAI',
  },
] as const;
```
Replace with:
```astro
---
import PublicLayout from '@/layouts/PublicLayout.astro';
import { EDITORIAL_DISPLAY_CATEGORIES as EDITORIAL_CATEGORIES } from '@/services/editorial/pillars';
```
All other usages (`getEditorialCategory`, the pill map with `count`, `selectedCategory`) stay unchanged.

- [ ] **Step 3: Type-check**

Run: `npx astro check`
Expected: same status as end of Task 1 (0 errors, or only the known `byPillar` Record error fixed in Task 3).

- [ ] **Step 4: Manual display check (dev, read-only)**

Ensure a dev server is running (`curl -s http://localhost:4321/ >/dev/null` or start `nohup npm run dev >/tmp/astro-dev.log 2>&1 &` and wait ~8s), then:
```bash
curl -s "http://localhost:4321/articles" | grep -o "海外AIビジネス" | head -1
```
Expected: NO output is acceptable and correct at this stage — the pill only renders when the WordPress category exists with count>0 (existing count>0 filter). What MUST still work: `curl -s "http://localhost:4321/articles" | grep -o "生成AIニュース" | head -1` returns `生成AIニュース` (existing pills unaffected). Run both and report.

- [ ] **Step 5: Commit**

```bash
git add src/pages/index.astro src/pages/articles/index.astro
git commit -m "Use shared editorial display categories on public pages"
```

---

### Task 3: Scoring prompt (4本柱), startup-dissection series, hashtags, daily balance

**Files:**
- Modify: `src/services/ai/prompts.ts` (SCORE_ARTICLE_PROMPT + GENERATE_BLOG_DRAFT_PROMPT)
- Modify: `src/services/drafts/generate.ts` (getHashtags)
- Modify: `src/pages/api/cron/process-articles.ts` (byPillar init)

**Interfaces:**
- Consumes: `PillarSlug` now includes `'overseas-ai-business'` (Task 1).

- [ ] **Step 1: SCORE_ARTICLE_PROMPT — pillar list**

Current lines:
```
- サイトの3本柱は「生成AI一般ニュース」「AI駆動開発」「フィジカルAI/ロボティクス」
- 生成AI一般ニュース: モデル、プロダクト、企業導入、政策、研究、産業動向
- AI駆動開発: コーディングエージェント、開発プロセス、DevOps、PM/QA、エンジニアリング組織
- フィジカルAI: ロボット、ヒューマノイド、自動運転、製造/物流現場、実世界で動くAI
```
Replace with:
```
- サイトの4本柱は「生成AI一般ニュース」「AI駆動開発」「フィジカルAI/ロボティクス」「海外AIビジネス」
- 生成AI一般ニュース: モデル、プロダクト、企業導入、政策、研究、産業動向
- AI駆動開発: コーディングエージェント、開発プロセス、DevOps、PM/QA、エンジニアリング組織
- フィジカルAI: ロボット、ヒューマノイド、自動運転、製造/物流現場、実世界で動くAI
- 海外AIビジネス: 海外AI企業・スタートアップの収益モデル、資金調達、M&A、市場構造、日本市場への示唆
```

- [ ] **Step 2: SCORE_ARTICLE_PROMPT — two more 3本柱 references**

Change:
```
- 8.5〜9.1: 自動公開候補。3本柱に明確に合い、具体的事実があり、読者への示唆を作れる
```
to:
```
- 8.5〜9.1: 自動公開候補。4本柱に明確に合い、具体的事実があり、読者への示唆を作れる
```
And change:
```
- 3本柱のどれにも明確に属さない場合、overall_scoreは最大7.4
```
to:
```
- 4本柱のどれにも明確に属さない場合、overall_scoreは最大7.4
```

- [ ] **Step 3: GENERATE_BLOG_DRAFT_PROMPT — startup-dissection series block**

The prompt currently has (between the 記事構成 section and the 出力形式 section):
```
## 記事構成
1. 何の話か（冒頭）
2. なぜ今それが重要か
3. 事実・背景の整理（元記事の具体的数字・引用を活用）
4. AIおじさんとしての見方・解釈（構造、実務、期待値、判断軸のいずれか）
5. 実務的な示唆 or 今後の論点
6. 軽いまとめ（任意）

## 出力形式（JSONのみ）
```
Insert a new section between them so it reads:
```
## 記事構成
1. 何の話か（冒頭）
2. なぜ今それが重要か
3. 事実・背景の整理（元記事の具体的数字・引用を活用）
4. AIおじさんとしての見方・解釈（構造、実務、期待値、判断軸のいずれか）
5. 実務的な示唆 or 今後の論点
6. 軽いまとめ（任意）

## シリーズ「スタートアップ解剖」（該当時のみ）
元記事が特定の海外AI企業・スタートアップ1社の深掘り（事業内容・資金調達・成長理由の分析）である場合のみ、以下に従う。
- titleOptions はいずれも「スタートアップ解剖：」で始める（例: スタートアップ解剖：Lovableはなぜ13Bドル評価なのか）
- 本文の見出し構成を「何をしている会社か」「なぜ伸びているのか」「収益モデル」「日本での応用可能性」とする
市場動向・資金調達統計・複数企業の話題など、1社の深掘りでない記事にはこの指示を適用しない。

## 出力形式（JSONのみ）
```

- [ ] **Step 4: Hashtag mapping (`src/services/drafts/generate.ts`)**

`getHashtags` currently:
```typescript
  for (const category of categories) {
    if (category.slug === 'physical-ai') tags.add('#フィジカルAI');
    if (category.slug === 'ai-driven-development') tags.add('#AI駆動開発');
    if (category.slug === 'generative-ai-news') tags.add('#生成AI');
  }
```
Add one line so it reads:
```typescript
  for (const category of categories) {
    if (category.slug === 'physical-ai') tags.add('#フィジカルAI');
    if (category.slug === 'ai-driven-development') tags.add('#AI駆動開発');
    if (category.slug === 'generative-ai-news') tags.add('#生成AI');
    if (category.slug === 'overseas-ai-business') tags.add('#AIビジネス');
  }
```

- [ ] **Step 5: Daily balance init (`src/pages/api/cron/process-articles.ts`)**

`getPublishStatsToday` currently:
```typescript
  const stats: PublishStats = {
    total: 0,
    byPillar: {
      'physical-ai': 0,
      'ai-driven-development': 0,
      'generative-ai-news': 0,
    },
  };
```
Change to:
```typescript
  const stats: PublishStats = {
    total: 0,
    byPillar: {
      'physical-ai': 0,
      'ai-driven-development': 0,
      'overseas-ai-business': 0,
      'generative-ai-news': 0,
    },
  };
```

- [ ] **Step 6: Type-check**

Run: `npx astro check`
Expected: **0 errors** (the `Record<PillarSlug, number>` is now complete).

- [ ] **Step 7: Commit**

```bash
git add src/services/ai/prompts.ts src/services/drafts/generate.ts src/pages/api/cron/process-articles.ts
git commit -m "Score, draft-series, hashtag, and daily-balance support for overseas pillar"
```

---

### Task 4: Idempotent source-insert script (create + dry-run only)

**Files:**
- Create: `scripts/add-overseas-sources.mjs`

**Interfaces:**
- Consumes: `sources` table (name, source_type, base_url, list_url, enabled, priority, tags). Service-role key from `.env`.

- [ ] **Step 1: Create `scripts/add-overseas-sources.mjs`**

```javascript
// One-off: add the 4 verified overseas-AI-business RSS sources.
// Dry run (default): show what would be inserted. Execute: node scripts/add-overseas-sources.mjs --execute
// Idempotent: skips any source whose list_url already exists.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const getEnv = (k) => (env.match(new RegExp('^' + k + '\\s*=\\s*"?([^"\\n]+)"?', 'm')) || [])[1]?.trim();

const db = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

// Feed URLs verified by direct fetch on 2026-07-08 (valid RSS/Atom XML).
const SOURCES = [
  {
    name: 'Crunchbase News',
    source_type: 'rss',
    base_url: 'https://news.crunchbase.com',
    list_url: 'https://news.crunchbase.com/feed/',
    priority: 6,
    tags: ['海外AIビジネス'],
    enabled: true,
  },
  {
    name: 'CB Insights Research',
    source_type: 'rss',
    base_url: 'https://www.cbinsights.com',
    list_url: 'https://www.cbinsights.com/research/feed/',
    priority: 6,
    tags: ['海外AIビジネス'],
    enabled: true,
  },
  {
    name: 'Sifted AI',
    source_type: 'rss',
    base_url: 'https://sifted.eu',
    list_url: 'https://sifted.eu/sector/artificial-intelligence/feed',
    priority: 5,
    tags: ['海外AIビジネス'],
    enabled: true,
  },
  {
    name: "Ben's Bites",
    source_type: 'rss',
    base_url: 'https://www.bensbites.com',
    list_url: 'https://www.bensbites.com/feed',
    priority: 5,
    tags: ['海外AIビジネス'],
    enabled: true,
  },
];

const execute = process.argv.includes('--execute');
let inserted = 0;
let skipped = 0;

for (const source of SOURCES) {
  const { data: existing, error: selErr } = await db
    .from('sources')
    .select('id')
    .eq('list_url', source.list_url)
    .limit(1)
    .maybeSingle();
  if (selErr) {
    console.error(`SELECT failed for ${source.name}: ${selErr.message}`);
    process.exit(1);
  }
  if (existing) {
    skipped++;
    console.log(`SKIP (exists): ${source.name}`);
    continue;
  }
  if (!execute) {
    console.log(`WOULD INSERT: ${source.name}  ${source.list_url}  priority=${source.priority}`);
    continue;
  }
  const { error: insErr } = await db.from('sources').insert(source);
  if (insErr) {
    console.error(`INSERT failed for ${source.name}: ${insErr.message}`);
    process.exit(1);
  }
  inserted++;
  console.log(`INSERTED: ${source.name}`);
}

console.log(
  execute
    ? `\nDone. inserted=${inserted} skipped=${skipped}`
    : `\n(dry run — nothing written. Re-run with --execute to insert.)`,
);
```

- [ ] **Step 2: Dry-run (no writes)**

Run: `node scripts/add-overseas-sources.mjs`
Expected: four `WOULD INSERT: ...` lines (or `SKIP (exists)` for any already present) and the dry-run footer. No inserts.

- [ ] **Step 3: Commit**

```bash
git add scripts/add-overseas-sources.mjs
git commit -m "Add idempotent script for overseas-AI-business sources"
```

---

## Rollout (after all tasks; with the user)

1. Merge to main, push, wait for Vercel deploy (prompt/pillar changes take effect on next hourly process-articles run).
2. Run `node scripts/add-overseas-sources.mjs --execute` → expect `inserted=4`. Verify in Supabase (`sources` has the 4 rows) and after ≤15 min the fetch-sources cron shows successful runs for them.
3. Real-world confirmation over the next hours/day: articles from the new sources get scored, and high scorers publish with the WordPress category 「海外AIビジネス」 (auto-created on first publish). The category pill then appears on `/articles`.

## Notes / Out of Scope

- No per-pillar daily quota, no image-model mapping for the new pillar (falls to Gemini default), no WordPress tag feature for スタートアップ解剖, no reclassification of past articles.
- Keyword `'vc'` is a substring match and could over-match in rare cases (same known trade-off as the existing `'qa'` keyword); acceptable because over-matching only adds a secondary category.
