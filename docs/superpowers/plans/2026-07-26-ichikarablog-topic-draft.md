# ichikarablog トピック指示ドラフト生成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AIおじさんのダッシュボードでトピックを指示すると、Web検索で下調べし、ユーザーのichikarablog文体で本文を生成し、ichikarablog.com に**下書きとして**投稿する。公開はダッシュボードのボタンから（WordPressログイン不要）。

**Architecture:** 既存部品（RAG文体検索・Claude構造化ドラフト生成・WordPress REST投稿・画像生成）をパラメータ化して流用する。WordPressクライアントに投稿先(`WordPressTarget`)を渡せるようにし、RAGに`corpus`列を足してichikarablog専用コーパスを分離する。新規の研究サービス(Anthropic Web検索)とオーケストレータ`composeDraftForTopic`を足し、`/admin/compose` UIから叩く。

**Tech Stack:** Astro 6 (SSR, Vercel adapter) / TypeScript / Supabase (Postgres + pgvector) / Anthropic SDK `^0.90.0` / WordPress REST API (Application Password) / Tailwind CSS v4

## Global Constraints

- 設計spec: `docs/superpowers/specs/2026-07-26-ichikarablog-topic-draft-design.md` に従う。
- **テストフレームワークは存在しない。** 検証は `npx astro check`（**0 errors** であること）＋ 一時検証スクリプト(`node --input-type=module`)＋dev画面の手動確認で行う。各タスクの「テスト」ステップはこれに読み替える。
- **compose経路は常に `status='draft'` でWordPressに投稿する。** 自動公開・SNS投稿は一切しない。公開は専用エンドポイントの明示呼び出しのみ。
- **既存のAIおじさんパイプラインを壊さない。** 追加する引数はすべて optional にし、未指定時は現行動作と完全に同一にする。
- 投稿先env名は厳密に `ICHIKARA_WP_BASE_URL` / `ICHIKARA_WP_USERNAME` / `ICHIKARA_WP_APP_PASSWORD`。
- コーパス識別子は厳密に `'aiojisan'`（既定）と `'ichikarablog'`。
- コミットメッセージ末尾に必ず付ける: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`
- パスエイリアスは `@/` = `src/`。ロガーは `createLogger('name')` を使う。

---

## File Structure

| ファイル | 責務 | 変更種別 |
|---|---|---|
| `supabase/migrations/004_compose_drafts_and_corpus.sql` | `blog_style_chunks.corpus`列追加、`match_blog_chunks` RPC拡張、`composed_drafts`表作成 | 新規 |
| `src/lib/env.ts` | `ICHIKARA_WP_*` を optional env として追加 | 変更 |
| `src/services/wordpress/target.ts` | `WordPressTarget`型と投稿先解決 | 新規 |
| `src/services/wordpress/client.ts` | 全公開関数に optional `target` を追加、`publishWordPressPost` 追加 | 変更 |
| `src/services/rag/retrieval.ts` | `corpus` オプションを追加 | 変更 |
| `src/services/rag/ingest.ts` | `corpus` をパラメータ化 | 変更 |
| `src/services/rag/ichikara-import.ts` | ichikarablogの記事をWP RESTから取得しコーパス投入 | 新規 |
| `src/pages/api/admin/ichikara-import.ts` | 取り込みバッチを叩くエンドポイント | 新規 |
| `src/services/research/websearch.ts` | Anthropic Web検索でトピック調査 | 新規 |
| `src/services/ai/prompts.ts` | `GENERATE_TOPIC_DRAFT_PROMPT` 追加 | 変更 |
| `src/services/ai/anthropic.ts` | `generateTopicDraftWithClaude` 追加 | 変更 |
| `src/services/drafts/compose.ts` | オーケストレータ `composeDraftForTopic` | 新規 |
| `src/pages/api/admin/compose-draft.ts` | 生成エンドポイント | 新規 |
| `src/pages/api/admin/compose-publish.ts` | 公開エンドポイント | 新規 |
| `src/pages/admin/compose/index.astro` | 生成フォーム＋一覧UI | 新規 |
| `src/layouts/AdminLayout.astro` | ナビに「記事を書く」を追加 | 変更 |

---

## Task 1: 基盤 — DBマイグレーションとenv

**Files:**
- Create: `supabase/migrations/004_compose_drafts_and_corpus.sql`
- Modify: `src/lib/env.ts:6-19`
- Modify: `.env.example`

**Interfaces:**
- Consumes: なし（最初のタスク）
- Produces: DBテーブル `composed_drafts`、列 `blog_style_chunks.corpus`、RPC `match_blog_chunks(query_embedding, match_threshold, match_count, p_corpus)`、env `ICHIKARA_WP_BASE_URL` / `ICHIKARA_WP_USERNAME` / `ICHIKARA_WP_APP_PASSWORD`（すべて optional string）

- [ ] **Step 1: マイグレーションSQLを書く**

Create `supabase/migrations/004_compose_drafts_and_corpus.sql`:

```sql
-- ── 1. Multi-corpus support for the style RAG ────────────────────────────────
-- Existing rows are the AIおじさん corpus; new ichikarablog rows use 'ichikarablog'.
ALTER TABLE blog_style_chunks
  ADD COLUMN IF NOT EXISTS corpus TEXT NOT NULL DEFAULT 'aiojisan';

CREATE INDEX IF NOT EXISTS blog_style_chunks_corpus_idx
  ON blog_style_chunks (corpus);

-- Extend the vector search with an optional corpus filter.
-- p_corpus = NULL keeps the previous behaviour (search every corpus).
-- Adding a parameter creates an overload rather than replacing the 3-arg
-- function from 001, which would make existing 3-argument calls ambiguous.
DROP FUNCTION IF EXISTS match_blog_chunks(VECTOR(1536), FLOAT, INT);

CREATE OR REPLACE FUNCTION match_blog_chunks(
  query_embedding VECTOR(1536),
  match_threshold FLOAT DEFAULT 0.7,
  match_count     INT DEFAULT 10,
  p_corpus        TEXT DEFAULT NULL
)
RETURNS TABLE (
  id             UUID,
  chunk_text     TEXT,
  post_title     TEXT,
  topic_tags     TEXT[],
  tone_tag       TEXT,
  structure_type TEXT,
  style_tags     TEXT[],
  similarity     FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    bsc.id,
    bsc.chunk_text,
    bsc.post_title,
    bsc.topic_tags,
    bsc.tone_tag,
    bsc.structure_type,
    bsc.style_tags,
    1 - (bsc.embedding <=> query_embedding) AS similarity
  FROM blog_style_chunks bsc
  WHERE bsc.embedding IS NOT NULL
    AND (p_corpus IS NULL OR bsc.corpus = p_corpus)
    AND 1 - (bsc.embedding <=> query_embedding) > match_threshold
  ORDER BY bsc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ── 2. Composed drafts (topic-directed drafts for the personal blog) ─────────
CREATE TABLE IF NOT EXISTS composed_drafts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  topic        TEXT NOT NULL,
  angle        TEXT,
  title        TEXT NOT NULL,
  outline      TEXT,
  body         TEXT NOT NULL,
  source_urls  JSONB NOT NULL DEFAULT '[]'::jsonb,
  wp_target    TEXT NOT NULL,
  wp_post_id   INT,
  category     TEXT,
  status       TEXT NOT NULL DEFAULT 'draft',
  error        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ,
  CONSTRAINT composed_drafts_status_check
    CHECK (status IN ('draft', 'published', 'failed'))
);

CREATE INDEX IF NOT EXISTS composed_drafts_created_at_idx
  ON composed_drafts (created_at DESC);
```

- [ ] **Step 2: マイグレーションを本番Supabaseに適用する**

Supabase SQL Editor（ダッシュボード）に上記SQLを貼って実行する。CLIが設定済みなら `supabase db push` でもよい。

Expected: エラーなく完了。

- [ ] **Step 3: 適用を検証する**

リポジトリルートで実行:

```bash
cd /Users/will/aiblog && node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = {};
for (const line of readFileSync('.env','utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)\$/); if (m) env[m[1]] = m[2];
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { error: e1 } = await db.from('composed_drafts').select('id').limit(1);
console.log('composed_drafts:', e1 ? 'FAIL ' + e1.message : 'OK');
const { data, error: e2 } = await db.from('blog_style_chunks').select('corpus').limit(1);
console.log('corpus column:', e2 ? 'FAIL ' + e2.message : 'OK (' + (data[0]?.corpus ?? 'no rows') + ')');
"
```

Expected: `composed_drafts: OK` と `corpus column: OK (aiojisan)` の2行。

- [ ] **Step 4: envスキーマを拡張する**

Modify `src/lib/env.ts` — `envSchema` の `// Optional` ブロックに3行足す:

```typescript
  // Optional
  ANTHROPIC_API_KEY: z.string().optional(),
  GOOGLE_AI_API_KEY: z.string().optional(),
  // Personal blog (ichikarablog.com) — topic-directed drafts
  ICHIKARA_WP_BASE_URL: z.string().url().optional(),
  ICHIKARA_WP_USERNAME: z.string().min(1).optional(),
  ICHIKARA_WP_APP_PASSWORD: z.string().min(1).optional(),
```

- [ ] **Step 5: `.env.example` に追記する**

Modify `.env.example` — 末尾に追記:

```
# Personal blog (ichikarablog.com) — topic-directed drafts
ICHIKARA_WP_BASE_URL=https://ichikarablog.com
ICHIKARA_WP_USERNAME=
ICHIKARA_WP_APP_PASSWORD=
```

- [ ] **Step 6: ユーザーに実際の認証情報の投入を依頼する**

ユーザーに次を依頼する（**このステップはコード変更なし。実行者が代行しないこと**）:
1. ichikarablog.com の管理画面 → ユーザー → プロフィール → アプリケーションパスワード を発行。
2. ローカル `.env` に `ICHIKARA_WP_BASE_URL` / `ICHIKARA_WP_USERNAME` / `ICHIKARA_WP_APP_PASSWORD` を記入。
3. Vercelの Environment Variables にも同じ3つを追加。

`.env` に値が入るまで Task 2 の接続テストは通らない。

- [ ] **Step 7: 型チェック**

Run: `cd /Users/will/aiblog && npx astro check 2>&1 | tail -5`
Expected: `0 errors`

- [ ] **Step 8: コミット**

```bash
cd /Users/will/aiblog
git add supabase/migrations/004_compose_drafts_and_corpus.sql src/lib/env.ts .env.example
git commit -m "$(cat <<'EOF'
Add composed_drafts table and multi-corpus style RAG

Adds a corpus column to blog_style_chunks (existing rows default to
'aiojisan') and an optional p_corpus filter on match_blog_chunks so the
ichikarablog voice can be retrieved separately. Adds composed_drafts to
track topic-directed drafts and their publish state, plus optional
ICHIKARA_WP_* env for the personal blog target.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: WordPress投稿先の抽象化

**Files:**
- Create: `src/services/wordpress/target.ts`
- Modify: `src/services/wordpress/client.ts`

**Interfaces:**
- Consumes: Task 1 の env `ICHIKARA_WP_*`
- Produces:
  - `export type WordPressTargetName = 'aiojisan' | 'ichikarablog'`
  - `export interface WordPressTarget { name: WordPressTargetName; baseUrl: string; username: string; appPassword: string }`
  - `export function resolveWordPressTarget(name?: WordPressTargetName): WordPressTarget`
  - `client.ts` の全公開関数が末尾に optional `target?: WordPressTarget` を受ける
  - `export async function publishWordPressPost(postId: number, target?: WordPressTarget): Promise<{ link: string }>`
  - `export async function testWordPressConnection(target?: WordPressTarget): Promise<boolean>`

- [ ] **Step 1: `target.ts` を書く**

Create `src/services/wordpress/target.ts`:

```typescript
// Which WordPress site a post goes to. Defaults to the AIおじさん site so
// every existing caller keeps its current behaviour.

import { getEnv } from '@/lib/env';

export type WordPressTargetName = 'aiojisan' | 'ichikarablog';

export interface WordPressTarget {
  name: WordPressTargetName;
  baseUrl: string;
  username: string;
  appPassword: string;
}

export function resolveWordPressTarget(name: WordPressTargetName = 'aiojisan'): WordPressTarget {
  const env = getEnv();

  if (name === 'ichikarablog') {
    const baseUrl = env.ICHIKARA_WP_BASE_URL;
    const username = env.ICHIKARA_WP_USERNAME;
    const appPassword = env.ICHIKARA_WP_APP_PASSWORD;
    if (!baseUrl || !username || !appPassword) {
      throw new Error(
        'ichikarablog is not configured: set ICHIKARA_WP_BASE_URL, ICHIKARA_WP_USERNAME and ICHIKARA_WP_APP_PASSWORD',
      );
    }
    return { name, baseUrl, username, appPassword };
  }

  return {
    name: 'aiojisan',
    baseUrl: env.WORDPRESS_BASE_URL,
    username: env.WORDPRESS_USERNAME,
    appPassword: env.WORDPRESS_APP_PASSWORD,
  };
}
```

- [ ] **Step 2: `client.ts` の内部ヘルパを target 対応にする**

Modify `src/services/wordpress/client.ts` — import に1行足し、`getAuthHeader` / `getApiBase` / `wpFetch` を差し替える。

import追加（`import { getEnv } from '@/lib/env';` の下）:

```typescript
import { resolveWordPressTarget, type WordPressTarget } from './target';
```

`getAuthHeader` と `getApiBase`（現行 51-60行）を次に置換:

```typescript
function getAuthHeader(target: WordPressTarget): string {
  const credentials = `${target.username}:${target.appPassword}`;
  return `Basic ${Buffer.from(credentials).toString('base64')}`;
}

function getApiBase(target: WordPressTarget): string {
  return `${target.baseUrl.replace(/\/$/, '')}/wp-json/wp/v2`;
}
```

`wpFetch`（現行 62-82行）を次に置換:

```typescript
async function wpFetch<T>(
  path: string,
  options: RequestInit = {},
  target: WordPressTarget = resolveWordPressTarget(),
): Promise<T> {
  const url = `${getApiBase(target)}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Authorization': getAuthHeader(target),
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`WordPress API error ${res.status} (${target.name}): ${body}`);
  }

  return res.json() as Promise<T>;
}
```

- [ ] **Step 3: 公開関数に optional target を通す**

Modify `src/services/wordpress/client.ts` — 各公開関数のシグネチャ末尾に `target` を足し、内部の `wpFetch` / `getApiBase` / `getAuthHeader` に渡す。

`createWordPressDraft`（現行 86-122行）を次に置換:

```typescript
export async function createWordPressDraft(
  title: string,
  body: string,
  excerpt?: string,
  slug?: string,
  status: 'draft' | 'publish' = 'draft',
  categories?: number[],
  publishDate?: string,
  target: WordPressTarget = resolveWordPressTarget(),
): Promise<{ id: number; editUrl: string }> {
  logger.info('Creating WordPress post', { title, slug, status, publishDate, target: target.name });

  const htmlBody = markdownToHtml(body);

  const payload: WpPostPayload = {
    title,
    content: htmlBody,
    status,
    excerpt,
    ...(target.name === 'aiojisan' ? { featured_media: PLACEHOLDER_MEDIA_ID } : {}),
    ...(categories && categories.length > 0 ? { categories } : {}),
    ...(slug ? { slug } : {}),
    // Backdate the post (WordPress publishes a past-dated post at that date)
    ...(publishDate ? { date_gmt: new Date(publishDate).toISOString().slice(0, 19) } : {}),
  };

  const post = await wpFetch<WpPostResponse>('/posts', {
    method: 'POST',
    body: JSON.stringify(payload),
  }, target);

  const editUrl = `${target.baseUrl}/wp-admin/post.php?post=${post.id}&action=edit`;

  logger.info('Post created', { id: post.id, status, editUrl, target: target.name });

  return { id: post.id, editUrl };
}
```

注: `PLACEHOLDER_MEDIA_ID`(125) はAIおじさんサイトのメディアIDなので、ichikarablogには送らない。

`getOrCreateWordPressCategory`（現行 124-148行）を次に置換:

```typescript
export async function getOrCreateWordPressCategory(
  name: string,
  slug: string,
  description?: string,
  target: WordPressTarget = resolveWordPressTarget(),
): Promise<number> {
  const existing = await wpFetch<WpCategoryResponse[]>(
    `/categories?slug=${encodeURIComponent(slug)}&per_page=1`,
    {},
    target,
  );

  if (existing[0]) {
    return existing[0].id;
  }

  const created = await wpFetch<WpCategoryResponse>('/categories', {
    method: 'POST',
    body: JSON.stringify({
      name,
      slug,
      ...(description ? { description } : {}),
    }),
  }, target);

  logger.info('WordPress category created', { id: created.id, name, slug, target: target.name });
  return created.id;
}
```

`updateWordPressDraft`（現行 150-161行）を次に置換:

```typescript
export async function updateWordPressDraft(
  postId: number,
  title: string,
  body: string,
  target: WordPressTarget = resolveWordPressTarget(),
): Promise<void> {
  logger.info('Updating WordPress draft', { postId, target: target.name });

  await wpFetch<WpPostResponse>(`/posts/${postId}`, {
    method: 'POST',
    body: JSON.stringify({ title, content: markdownToHtml(body) }),
  }, target);
}
```

`testWordPressConnection`（現行 163-171行）を次に置換:

```typescript
export async function testWordPressConnection(
  target: WordPressTarget = resolveWordPressTarget(),
): Promise<boolean> {
  try {
    await wpFetch<unknown>('/users/me', {}, target);
    return true;
  } catch (err) {
    logger.error('WordPress connection test failed', { err: String(err), target: target.name });
    return false;
  }
}
```

- [ ] **Step 4: 画像添付とプレースホルダ一覧に target を通す**

Modify `src/services/wordpress/client.ts` — `generateAndAttachFeaturedImage`（現行 177-227行）のシグネチャと内部呼び出しを差し替える:

```typescript
export async function generateAndAttachFeaturedImage(
  postId: number,
  title: string,
  summary: string,
  slug: string,
  pillar?: string,
  target: WordPressTarget = resolveWordPressTarget(),
): Promise<void> {
  logger.info('Generating featured image', { postId, slug, pillar, target: target.name });
```

同関数内、`const mediaUrl = ...` と `mediaRes` を次に置換:

```typescript
  const filename = `${slug}.png`;
  const mediaUrl = `${getApiBase(target)}/media`;

  const mediaRes = await fetch(mediaUrl, {
    method: 'POST',
    headers: {
      'Authorization': getAuthHeader(target),
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Type': 'image/png',
    },
    body: new Uint8Array(imageBuffer),
  });
```

同関数末尾の添付呼び出しを次に置換:

```typescript
  await wpFetch<WpPostResponse>(`/posts/${postId}`, {
    method: 'POST',
    body: JSON.stringify({ featured_media: media.id }),
  }, target);
```

`listPublishedPostsWithPlaceholderImage`（現行 264行〜）内の `wpFetch` 呼び出しは第3引数を省略してよい（既定=aiojisan、これはAIおじさん専用機能のため）。変更不要。

- [ ] **Step 5: 公開用関数を足す**

Modify `src/services/wordpress/client.ts` — `updateWordPressDraft` の直後に追加:

```typescript
// Flip an existing draft to published. Used by the compose dashboard so the
// user never has to log into WordPress (app-password REST bypasses 2FA).
export async function publishWordPressPost(
  postId: number,
  target: WordPressTarget = resolveWordPressTarget(),
): Promise<{ link: string }> {
  logger.info('Publishing WordPress post', { postId, target: target.name });

  const post = await wpFetch<WpPostResponse & { link: string }>(`/posts/${postId}`, {
    method: 'POST',
    body: JSON.stringify({ status: 'publish' }),
  }, target);

  return { link: post.link };
}
```

- [ ] **Step 6: 型チェック（既存呼び出しが壊れていないこと）**

Run: `cd /Users/will/aiblog && npx astro check 2>&1 | tail -5`
Expected: `0 errors`（既存の `generateDraftForArticle` 等は target 未指定のまま通る）

- [ ] **Step 7: 両サイトへの接続を実地確認する**

devサーバを起動していない状態で、一時スクリプトでは `import.meta.env` が使えないため、**dev経由で確認する**。まず既存の管理画面が生きているかを型と起動で担保し、実接続は Task 6 のE2Eで確認する。

ここでは最低限、ichikarablogのRESTが**アプリパスで到達可能か**を素のcurlで確認する:

```bash
cd /Users/will/aiblog
BASE=$(grep '^ICHIKARA_WP_BASE_URL=' .env | cut -d= -f2-)
USER=$(grep '^ICHIKARA_WP_USERNAME=' .env | cut -d= -f2-)
PASS=$(grep '^ICHIKARA_WP_APP_PASSWORD=' .env | cut -d= -f2-)
curl -s -u "$USER:$PASS" "$BASE/wp-json/wp/v2/users/me?_fields=id,name" -w "\nHTTP %{http_code}\n"
```

Expected: `HTTP 200` と自分のユーザー名を含むJSON。401なら認証情報を見直す（Task 1 Step 6）。

- [ ] **Step 8: コミット**

```bash
cd /Users/will/aiblog
git add src/services/wordpress/target.ts src/services/wordpress/client.ts
git commit -m "$(cat <<'EOF'
Make the WordPress client multi-target

Adds WordPressTarget (aiojisan | ichikarablog) resolved from env, and
threads an optional target through every client function — omitted, it
resolves to the AIおじさん site, so existing callers are unchanged. Adds
publishWordPressPost so a draft can be flipped to published over REST
without logging into WordPress. The AIおじさん placeholder media id is no
longer sent to other targets.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: RAGのコーパス分離とichikarablog取り込み

**Files:**
- Modify: `src/services/rag/retrieval.ts`
- Modify: `src/services/rag/ingest.ts`
- Create: `src/services/rag/ichikara-import.ts`
- Create: `src/pages/api/admin/ichikara-import.ts`

**Interfaces:**
- Consumes: Task 1 の `corpus` 列・RPC `p_corpus`、Task 2 の `resolveWordPressTarget`
- Produces:
  - `retrieveStyleChunks(queryText, { matchThreshold?, matchCount?, corpus? })`
  - `getStyleChunksForDraft(articleTitle, topics, corpus?)` — `corpus` 省略時は従来通り全コーパス検索
  - `ingestBlogPost(post, corpus?)` / `ingestBlogPosts(posts, corpus?)` — 既定 `'aiojisan'`
  - `importIchikaraPosts(options?: { limit?: number; startPage?: number }): Promise<{ posts: number; chunks: number; nextPage: number | null }>`
  - `POST /api/admin/ichikara-import`

- [ ] **Step 1: retrieval に corpus を通す**

Modify `src/services/rag/retrieval.ts` — `retrieveStyleChunks`（現行 22-67行）のオプションとRPC呼び出しを差し替える:

```typescript
export async function retrieveStyleChunks(
  queryText: string,
  options: {
    matchThreshold?: number;
    matchCount?: number;
    corpus?: string;
  } = {},
): Promise<RetrievedChunk[]> {
  const { matchThreshold = 0.65, matchCount = 8, corpus } = options;

  logger.info('Retrieving style chunks', { queryLength: queryText.length, corpus: corpus ?? '(all)' });

  const ai = getAiProvider();
  const embedding = await ai.generateEmbedding(queryText);

  const db = getAdminClient();
  const { data, error } = await db.rpc('match_blog_chunks', {
    query_embedding: embedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
    p_corpus: corpus ?? null,
  });
```

（以降の `if (error)` 以下は現行のまま変更しない）

- [ ] **Step 2: getStyleChunksForDraft に corpus を通す**

Modify `src/services/rag/retrieval.ts` — `getStyleChunksForDraft`（現行 71-89行）を次に置換:

```typescript
export async function getStyleChunksForDraft(
  articleTitle: string,
  topics: string[],
  corpus?: string,
): Promise<string[]> {
  const query = `${articleTitle} ${topics.join(' ')}`;

  const chunks = await retrieveStyleChunks(query, {
    matchThreshold: 0.60,
    matchCount: 5,
    corpus,
  });

  if (chunks.length === 0) {
    logger.info('No style chunks found for draft', { corpus: corpus ?? '(all)' });
    return [];
  }

  // Return just the text for prompt injection
  return chunks.map(c => c.chunkText);
}
```

- [ ] **Step 3: ingest に corpus を通す**

Modify `src/services/rag/ingest.ts` — `ingestBlogPost`（現行 24行〜）のシグネチャとinsertを差し替える:

```typescript
export async function ingestBlogPost(post: RawBlogPost, corpus = 'aiojisan'): Promise<number> {
```

同関数内、重複チェックのクエリに corpus 条件を足す:

```typescript
    const { count } = await db
      .from('blog_style_chunks')
      .select('id', { count: 'exact', head: true })
      .eq('source_post_id', post.id)
      .eq('chunk_index', chunk.index)
      .eq('corpus', corpus);
```

insertペイロードに `corpus` を足す（`embedding,` の直前）:

```typescript
      style_tags: metadata.styleTags,
      corpus,
      embedding,
```

`ingestBlogPosts`（現行 91行〜）を次に置換:

```typescript
export async function ingestBlogPosts(posts: RawBlogPost[], corpus = 'aiojisan'): Promise<number> {
  let totalInserted = 0;

  for (const post of posts) {
    const count = await ingestBlogPost(post, corpus);
    totalInserted += count;
    // Brief pause to respect rate limits
    await new Promise(r => setTimeout(r, 500));
  }

  logger.info('Batch ingestion complete', {
    posts: posts.length,
    totalChunks: totalInserted,
    corpus,
  });

  return totalInserted;
}
```

- [ ] **Step 4: ichikarablog取り込みサービスを書く**

Create `src/services/rag/ichikara-import.ts`:

```typescript
// One-off (resumable) import of ichikarablog.com posts into the style corpus.
// Runs page by page so a serverless invocation never has to embed ~1000 posts
// in one go — the caller keeps posting until nextPage is null.

import { resolveWordPressTarget } from '@/services/wordpress/target';
import { createLogger } from '@/lib/logger';
import { ingestBlogPosts, type RawBlogPost } from './ingest';

const logger = createLogger('ichikara-import');

export const ICHIKARA_CORPUS = 'ichikarablog';

const PER_PAGE = 10;

interface WpPost {
  id: number;
  link: string;
  date_gmt: string;
  title: { rendered: string };
  content: { rendered: string };
  excerpt: { rendered: string };
}

export async function importIchikaraPosts(
  options: { limit?: number; startPage?: number } = {},
): Promise<{ posts: number; chunks: number; nextPage: number | null }> {
  const { limit = 1, startPage = 1 } = options;
  const target = resolveWordPressTarget('ichikarablog');
  const apiBase = `${target.baseUrl.replace(/\/$/, '')}/wp-json/wp/v2`;

  let page = startPage;
  let importedPosts = 0;
  let importedChunks = 0;
  let nextPage: number | null = null;

  for (let i = 0; i < limit; i++) {
    const url =
      `${apiBase}/posts?status=publish&per_page=${PER_PAGE}&page=${page}` +
      `&orderby=date&order=desc&_fields=id,link,date_gmt,title,content,excerpt`;

    const res = await fetch(url);
    if (!res.ok) {
      const body = await res.text();
      // WordPress 400s when paging past the end — that means we are done.
      if (res.status === 400) {
        logger.info('Reached the end of ichikarablog posts', { page });
        nextPage = null;
        break;
      }
      throw new Error(`ichikarablog fetch failed ${res.status}: ${body}`);
    }

    const batch = (await res.json()) as WpPost[];
    if (batch.length === 0) {
      nextPage = null;
      break;
    }

    const posts: RawBlogPost[] = batch.map(p => ({
      id: `ichikara-${p.id}`,
      title: p.title.rendered,
      url: p.link,
      published_at: p.date_gmt ? `${p.date_gmt}Z` : null,
      content: p.content.rendered,
      excerpt: p.excerpt.rendered,
    }));

    const chunks = await ingestBlogPosts(posts, ICHIKARA_CORPUS);
    importedPosts += posts.length;
    importedChunks += chunks;

    logger.info('ichikarablog page imported', { page, posts: posts.length, chunks });

    if (batch.length < PER_PAGE) {
      nextPage = null;
      break;
    }
    page++;
    nextPage = page;
  }

  return { posts: importedPosts, chunks: importedChunks, nextPage };
}
```

- [ ] **Step 5: 取り込みエンドポイントを書く**

Create `src/pages/api/admin/ichikara-import.ts`:

```typescript
// API: import ichikarablog posts into the style corpus (resumable).
// Protected by CRON_SECRET because it spends embedding credits.

import type { APIRoute } from 'astro';
import { requireCronAuth } from '@/lib/auth';
import { importIchikaraPosts } from '@/services/rag/ichikara-import';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:ichikara-import');

export const POST: APIRoute = async ({ request }) => {
  const authError = requireCronAuth(request);
  if (authError) return authError;

  let limit = 1;
  let startPage = 1;
  try {
    const body = (await request.json()) as { limit?: number; start_page?: number };
    if (typeof body.limit === 'number') limit = Math.min(Math.max(1, body.limit), 5);
    if (typeof body.start_page === 'number') startPage = Math.max(1, body.start_page);
  } catch {
    // defaults are fine
  }

  try {
    const result = await importIchikaraPosts({ limit, startPage });
    return new Response(JSON.stringify({ ok: true, ...result }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    logger.error('ichikarablog import failed', { err: String(err) });
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
```

- [ ] **Step 6: 型チェック**

Run: `cd /Users/will/aiblog && npx astro check 2>&1 | tail -5`
Expected: `0 errors`

- [ ] **Step 7: 1ページだけ取り込んで動作を確認する**

devサーバを起動（`preview_start` の `astro-dev`、または `npm run dev`）してから:

```bash
cd /Users/will/aiblog
SECRET=$(grep '^CRON_SECRET=' .env | cut -d= -f2-)
curl -s -X POST http://localhost:4321/api/admin/ichikara-import \
  -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"limit":1,"start_page":1}' -w "\nHTTP %{http_code}\n"
```

Expected: `{"ok":true,"posts":10,"chunks":<正の数>,"nextPage":2}` と `HTTP 200`。

続けてコーパスに入ったことを確認:

```bash
cd /Users/will/aiblog && node --input-type=module -e "
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
const env = {};
for (const line of readFileSync('.env','utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)\$/); if (m) env[m[1]] = m[2];
}
const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const { count } = await db.from('blog_style_chunks').select('id', { count: 'exact', head: true }).eq('corpus','ichikarablog');
console.log('ichikarablog chunks:', count);
"
```

Expected: 正の数（0でないこと）。

- [ ] **Step 8: コミット**

```bash
cd /Users/will/aiblog
git add src/services/rag/retrieval.ts src/services/rag/ingest.ts src/services/rag/ichikara-import.ts src/pages/api/admin/ichikara-import.ts
git commit -m "$(cat <<'EOF'
Add ichikarablog voice corpus import

Threads an optional corpus through style retrieval and ingestion (default
'aiojisan', so existing behaviour is unchanged) and adds a resumable
importer that pulls ichikarablog.com posts over REST, chunks and embeds
them under corpus 'ichikarablog'. The endpoint takes a page at a time so a
~1000-post backlog can be imported without one long invocation.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 9: 残りのコーパスを取り込む（バックグラウンド運用）**

`nextPage` が null になるまで繰り返す。1回あたり5ページ（50本）を目安に:

```bash
cd /Users/will/aiblog
SECRET=$(grep '^CRON_SECRET=' .env | cut -d= -f2-)
curl -s -X POST http://localhost:4321/api/admin/ichikara-import \
  -H "Authorization: Bearer $SECRET" -H "Content-Type: application/json" \
  -d '{"limit":5,"start_page":2}'
```

以降 `start_page` を返ってきた `nextPage` に差し替えて続行する。**このステップは時間がかかるので、Task 4以降と並行して進めてよい**（Task 6のE2E前に十分な本数が入っていればよい。目安200本以上）。

---

## Task 4: Web検索リサーチとトピック執筆プロンプト

**Files:**
- Create: `src/services/research/websearch.ts`
- Modify: `src/services/ai/prompts.ts`
- Modify: `src/services/ai/anthropic.ts`
- Modify: `src/types/ai.ts`

**Interfaces:**
- Consumes: `getAnthropicKey()` from `@/lib/env`
- Produces:
  - `export interface ResearchSource { title: string; url: string }`
  - `export interface TopicResearch { findings: string; sources: ResearchSource[] }`
  - `export async function researchTopic(topic: string, angle?: string): Promise<TopicResearch>`
  - `export interface TopicDraftInput { topic: string; angle?: string; findings: string; sources: ResearchSource[]; styleChunks: string[] }`（`src/types/ai.ts`）
  - `export async function generateTopicDraftWithClaude(input: TopicDraftInput): Promise<BlogDraftOutput>`
  - `export const GENERATE_TOPIC_DRAFT_PROMPT: string`

- [ ] **Step 1: 型を足す**

Modify `src/types/ai.ts` — `BlogDraftOutput` の定義の下に追加:

```typescript
export interface ResearchSource {
  title: string;
  url: string;
}

export interface TopicDraftInput {
  topic: string;
  angle?: string;
  findings: string;          // What the web research turned up
  sources: ResearchSource[]; // Cited URLs to list at the end of the post
  styleChunks: string[];     // Retrieved RAG chunks (ichikarablog voice)
}
```

- [ ] **Step 2: リサーチサービスを書く**

Create `src/services/research/websearch.ts`:

```typescript
// Topic research via Claude's server-side web search tool. Returns prose
// findings plus the URLs Claude actually consulted, so the draft can cite them.

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import type { ResearchSource } from '@/types/ai';

const logger = createLogger('research');

const RESEARCH_MODEL = 'claude-sonnet-4-6';
const MAX_SEARCHES = 5;

export interface TopicResearch {
  findings: string;
  sources: ResearchSource[];
}

export async function researchTopic(topic: string, angle?: string): Promise<TopicResearch> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });

  const prompt =
    `次のトピックについて、日本語のブログ記事を書くための下調べをしてください。\n\n` +
    `## トピック\n${topic}\n\n` +
    (angle ? `## 切り口・補足\n${angle}\n\n` : '') +
    `## 指示\n` +
    `- 必要に応じてWeb検索を使い、最新の事実・数字・固有名詞・日付を集める\n` +
    `- 出典が確認できた事実と、一般論・背景知識を区別して書く\n` +
    `- 箇条書き中心で、記事の材料になる粒度でまとめる\n` +
    `- 推測で数字や固有名詞を作らない`;

  logger.info('Researching topic', { topic: topic.slice(0, 80), model: RESEARCH_MODEL });

  const message = await client.messages.create({
    model: RESEARCH_MODEL,
    max_tokens: 4096,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: MAX_SEARCHES,
      } as unknown as Anthropic.Tool,
    ],
    messages: [{ role: 'user', content: prompt }],
  });

  const findings = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();

  const sources = extractSources(message.content);

  logger.info('Research complete', { findingsLength: findings.length, sources: sources.length });

  return { findings, sources };
}

// Pull cited URLs out of both web_search results and inline citations.
function extractSources(content: unknown[]): ResearchSource[] {
  const seen = new Map<string, string>();

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!node || typeof node !== 'object') return;

    const record = node as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url : null;
    if (url && url.startsWith('http') && !seen.has(url)) {
      const title = typeof record.title === 'string' && record.title.trim().length > 0
        ? record.title.trim()
        : url;
      seen.set(url, title);
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') visit(value);
    }
  };

  visit(content);

  return [...seen.entries()].map(([url, title]) => ({ url, title })).slice(0, 10);
}
```

注: Web検索ツールが利用不可・失敗した場合でも `messages.create` は例外を投げうる。呼び出し側（Task 5）で握って続行する。

- [ ] **Step 3: トピック執筆プロンプトを書く**

Modify `src/services/ai/prompts.ts` — ファイル末尾に追加:

```typescript
export const GENERATE_TOPIC_DRAFT_PROMPT = `
あなたは個人ブログの書き手です。指定されたトピックについて、下調べの内容をもとに、
「過去記事の文体サンプル」に現れている自分自身の声で記事の下書きを書いてください。

## トピック
{topic}

## 切り口・補足
{angle}

## 下調べ（Web検索の結果）
{findings}

## 参照した情報源
{sourceList}

## 文体について（最重要）
下の「過去記事の文体サンプル」は、あなた自身が過去に書いた文章です。
語り口、リズム、一人称、句読点の打ち方、脱線の仕方、読者との距離感を観察し、それに寄せて書いてください。
ニュースメディアの解説調にしないこと。個人のブログとして書くこと。

## 過去記事の文体サンプル（文体の参考。内容のコピーは不可）
{styleChunks}

## 書き方のルール
- 下調べで確認できた事実（数字・固有名詞・日付）は積極的に使う
- 下調べにない事実を推測で作らない。わからないことは「わからない」と書く
- 事実と自分の意見の境界をはっきりさせる
- 「〜と言えるでしょう」「革新的」「画期的」のような無味乾燥な表現を使わない
- 結論を曖昧に逃げない。ただし断定できないことは断定しない
- 1文を長くしすぎない。段落でリズムを作る
- 読者が読み終えて「読んでよかった」と思える具体を必ず入れる

## 本文の末尾に必ず入れるもの
「## 参考リンク」という見出しを立て、上の「参照した情報源」をマークダウンのリンク一覧で列挙する。
情報源が空の場合は、代わりに「※ この記事はWeb検索での確認を行わずに書いています。」の1行を入れる。

## 出力形式（JSONのみ）
{
  "titleOptions": [
    "タイトル案1",
    "タイトル案2",
    "タイトル案3"
  ],
  "slug": "english-url-slug-in-kebab-case",
  "outline": "## 見出し1\\n- ポイント\\n## 見出し2\\n...",
  "body": "本文全文（マークダウン形式）"
}

## slugのルール
- 英語のみ、小文字、ハイフン区切り（例: adhd-focus-routine-experiment）
- タイトルの内容を英語で簡潔に表現（3〜6単語程度）
- 日本語を含めない

## 注意
- 本文は2000〜3500字程度を目安にする
- 見出しは具体的にする
- AIが書いた無味乾燥な文にしない
`.trim();
```

- [ ] **Step 4: `generateTopicDraftWithClaude` を書く**

Modify `src/services/ai/anthropic.ts` — import行を差し替える:

```typescript
import { GENERATE_BLOG_DRAFT_PROMPT, GENERATE_TOPIC_DRAFT_PROMPT } from './prompts';
import type { BlogDraftInput, BlogDraftOutput, TopicDraftInput } from '@/types/ai';
```

ファイル末尾（`normalizeTitleOptions` の後）に追加:

```typescript
// Topic-directed draft for the personal blog. Same structured-output tool as
// the news draft, but the prompt is voice-first and research-backed instead of
// being anchored to a source article.
export async function generateTopicDraftWithClaude(input: TopicDraftInput): Promise<BlogDraftOutput> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });

  const styleChunkText = input.styleChunks.length > 0
    ? input.styleChunks.map((c, i) => `[サンプル${i + 1}]\n${c}`).join('\n\n')
    : '（文体サンプルなし）';

  const sourceList = input.sources.length > 0
    ? input.sources.map(s => `- [${s.title}](${s.url})`).join('\n')
    : '（参照した情報源なし）';

  const prompt = fillTemplate(GENERATE_TOPIC_DRAFT_PROMPT, {
    topic: input.topic,
    angle: input.angle ?? '（指定なし）',
    findings: input.findings || '（下調べの結果なし）',
    sourceList,
    styleChunks: styleChunkText,
  });

  logger.info('Generating topic draft with Claude', {
    topic: input.topic.slice(0, 80),
    model: DRAFT_MODEL,
    sources: input.sources.length,
    styleChunks: input.styleChunks.length,
  });

  const message = await client.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 8192,
    tools: [DRAFT_TOOL],
    tool_choice: { type: 'tool', name: 'submit_blog_draft' },
    messages: [{ role: 'user', content: prompt }],
  });

  if (message.stop_reason === 'max_tokens') {
    logger.warn('Topic draft hit max_tokens — output likely truncated', {
      topic: input.topic.slice(0, 80),
      model: DRAFT_MODEL,
    });
  }

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    logger.error('Claude did not return the topic draft tool call', { stopReason: message.stop_reason });
    throw new Error('Claude topic draft generation: no structured output');
  }

  const raw = toolUse.input as { titleOptions: unknown; slug: string; outline: string; body: string };

  const titleOptions = normalizeTitleOptions(raw.titleOptions);

  const slug = (raw.slug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'blog-post';

  return {
    titleOptions,
    slug,
    outline: raw.outline,
    body: raw.body,
    model: DRAFT_MODEL,
  };
}
```

- [ ] **Step 5: 型チェック**

Run: `cd /Users/will/aiblog && npx astro check 2>&1 | tail -5`
Expected: `0 errors`

Web検索ツール型が SDK の `Anthropic.Tool` と合わない場合は Step 2 の `as unknown as Anthropic.Tool` で吸収済み。それでもエラーが出る場合は `tools: [...] as Anthropic.MessageCreateParams['tools']` で吸収する。

- [ ] **Step 6: コミット**

```bash
cd /Users/will/aiblog
git add src/services/research/websearch.ts src/services/ai/prompts.ts src/services/ai/anthropic.ts src/types/ai.ts
git commit -m "$(cat <<'EOF'
Add topic research and voice-first draft generation

researchTopic runs Claude's server-side web search over a topic and returns
prose findings plus the URLs it consulted. generateTopicDraftWithClaude
reuses the existing structured-output tool with a new prompt that leads with
the writer's own voice samples instead of a source article, and requires a
参考リンク section built from the cited URLs.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: オーケストレータと生成/公開API

**Files:**
- Create: `src/services/drafts/compose.ts`
- Create: `src/pages/api/admin/compose-draft.ts`
- Create: `src/pages/api/admin/compose-publish.ts`

**Interfaces:**
- Consumes: Task 2 の `resolveWordPressTarget` / `createWordPressDraft` / `generateAndAttachFeaturedImage` / `getOrCreateWordPressCategory` / `publishWordPressPost`、Task 3 の `getStyleChunksForDraft(title, topics, corpus)` と `ICHIKARA_CORPUS`、Task 4 の `researchTopic` / `generateTopicDraftWithClaude`
- Produces:
  - `export interface ComposeInput { topic: string; angle?: string; categorySlug?: string }`
  - `export interface ComposeResult { id: string; wpPostId: number | null; title: string; status: 'draft' | 'failed'; sources: ResearchSource[] }`
  - `export async function composeDraftForTopic(input: ComposeInput): Promise<ComposeResult>`
  - `export async function publishComposedDraft(id: string): Promise<{ link: string }>`
  - `POST /api/admin/compose-draft`、`POST /api/admin/compose-publish`

- [ ] **Step 1: オーケストレータを書く**

Create `src/services/drafts/compose.ts`:

```typescript
// Topic-directed draft composition for the personal blog (ichikarablog).
// Research → voice retrieval → draft → image → WordPress DRAFT. Never publishes.

import { getAdminClient } from '@/lib/supabase/server';
import { researchTopic } from '@/services/research/websearch';
import { getStyleChunksForDraft } from '@/services/rag/retrieval';
import { ICHIKARA_CORPUS } from '@/services/rag/ichikara-import';
import { generateTopicDraftWithClaude } from '@/services/ai/anthropic';
import {
  createWordPressDraft,
  generateAndAttachFeaturedImage,
  getOrCreateWordPressCategory,
  publishWordPressPost,
} from '@/services/wordpress/client';
import { resolveWordPressTarget } from '@/services/wordpress/target';
import { createLogger } from '@/lib/logger';
import type { ResearchSource } from '@/types/ai';

const logger = createLogger('compose');

const WP_TARGET = 'ichikarablog' as const;

export interface ComposeInput {
  topic: string;
  angle?: string;
  categorySlug?: string;
}

export interface ComposeResult {
  id: string;
  wpPostId: number | null;
  title: string;
  status: 'draft' | 'failed';
  sources: ResearchSource[];
}

export async function composeDraftForTopic(input: ComposeInput): Promise<ComposeResult> {
  const db = getAdminClient();
  const { topic, angle, categorySlug } = input;

  logger.info('Composing draft', { topic: topic.slice(0, 80), categorySlug });

  // 1. Research. Failing research must not kill the draft — we fall back to
  //    model knowledge and say so in the post.
  let findings = '';
  let sources: ResearchSource[] = [];
  try {
    const research = await researchTopic(topic, angle);
    findings = research.findings;
    sources = research.sources;
  } catch (err) {
    logger.warn('Topic research failed, continuing without live sources', {
      topic: topic.slice(0, 80),
      err: String(err),
    });
  }

  // 2. Voice: retrieve the writer's own past chunks from the ichikarablog corpus.
  const styleChunks = await getStyleChunksForDraft(topic, angle ? [angle] : [], ICHIKARA_CORPUS);

  // 3. Draft.
  const draft = await generateTopicDraftWithClaude({
    topic,
    angle,
    findings,
    sources,
    styleChunks,
  });

  const title = draft.titleOptions[0];
  const target = resolveWordPressTarget(WP_TARGET);

  // 4. Category (optional).
  const categoryIds: number[] = [];
  if (categorySlug) {
    try {
      const categoryId = await getOrCreateWordPressCategory(
        categorySlug,
        categorySlug,
        undefined,
        target,
      );
      categoryIds.push(categoryId);
    } catch (err) {
      logger.warn('Category assignment failed, posting without category', {
        categorySlug,
        err: String(err),
      });
    }
  }

  // 5. Post as a DRAFT on ichikarablog.
  let wpPostId: number | null = null;
  let status: 'draft' | 'failed' = 'draft';
  let errorMessage: string | null = null;

  try {
    const post = await createWordPressDraft(
      title,
      draft.body,
      undefined,
      draft.slug,
      'draft',
      categoryIds.length > 0 ? categoryIds : undefined,
      undefined,
      target,
    );
    wpPostId = post.id;
  } catch (err) {
    status = 'failed';
    errorMessage = String(err);
    logger.error('ichikarablog draft post failed', { err: errorMessage });
  }

  // 6. Featured image (best effort — a missing image never fails the draft).
  if (wpPostId !== null) {
    try {
      await generateAndAttachFeaturedImage(
        wpPostId,
        title,
        findings.slice(0, 150),
        draft.slug,
        undefined,
        target,
      );
    } catch (err) {
      logger.warn('Featured image failed, draft kept without image', {
        wpPostId,
        err: String(err),
      });
    }
  }

  // 7. Record.
  const { data, error } = await db
    .from('composed_drafts')
    .insert({
      topic,
      angle: angle ?? null,
      title,
      outline: draft.outline,
      body: draft.body,
      source_urls: sources,
      wp_target: WP_TARGET,
      wp_post_id: wpPostId,
      category: categorySlug ?? null,
      status,
      error: errorMessage,
    })
    .select('id')
    .single();

  if (error) {
    logger.error('composed_drafts insert failed', { error: error.message });
    throw new Error(`Draft was generated but could not be recorded: ${error.message}`);
  }

  logger.info('Compose complete', { id: data.id, wpPostId, status, sources: sources.length });

  return { id: data.id, wpPostId, title, status, sources };
}

// Flip a composed draft to published on ichikarablog. Idempotent.
export async function publishComposedDraft(id: string): Promise<{ link: string }> {
  const db = getAdminClient();

  const { data: row, error } = await db
    .from('composed_drafts')
    .select('id, wp_post_id, status')
    .eq('id', id)
    .single();

  if (error || !row) throw new Error('Composed draft not found');
  if (row.wp_post_id === null) throw new Error('This draft was never posted to WordPress');

  const target = resolveWordPressTarget(WP_TARGET);
  const { link } = await publishWordPressPost(row.wp_post_id, target);

  if (row.status !== 'published') {
    await db
      .from('composed_drafts')
      .update({ status: 'published', published_at: new Date().toISOString() })
      .eq('id', id);
  }

  logger.info('Composed draft published', { id, wpPostId: row.wp_post_id, link });
  return { link };
}
```

- [ ] **Step 2: 生成エンドポイントを書く**

Create `src/pages/api/admin/compose-draft.ts`:

```typescript
// API: compose a topic-directed draft on ichikarablog (draft only).

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/auth';
import { composeDraftForTopic } from '@/services/drafts/compose';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:compose-draft');

export const POST: APIRoute = async (context) => {
  const authError = await requireAdminSession(context);
  if (authError) return authError;

  const form = await context.request.formData();
  const topic = String(form.get('topic') ?? '').trim();
  const angleRaw = String(form.get('angle') ?? '').trim();
  const categoryRaw = String(form.get('category') ?? '').trim();

  if (!topic) {
    return context.redirect('/admin/compose?error=' + encodeURIComponent('トピックを入力してください'));
  }

  try {
    const result = await composeDraftForTopic({
      topic,
      angle: angleRaw || undefined,
      categorySlug: categoryRaw || undefined,
    });

    if (result.status === 'failed') {
      return context.redirect(
        '/admin/compose?error=' + encodeURIComponent('下書きは生成しましたが、ichikarablogへの投稿に失敗しました'),
      );
    }

    return context.redirect('/admin/compose?composed=1');
  } catch (err) {
    logger.error('Compose failed', { err: String(err) });
    return context.redirect('/admin/compose?error=' + encodeURIComponent(String(err).slice(0, 200)));
  }
};
```

- [ ] **Step 3: 公開エンドポイントを書く**

Create `src/pages/api/admin/compose-publish.ts`:

```typescript
// API: publish a composed draft on ichikarablog (no WordPress login needed).

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/auth';
import { publishComposedDraft } from '@/services/drafts/compose';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:compose-publish');

export const POST: APIRoute = async (context) => {
  const authError = await requireAdminSession(context);
  if (authError) return authError;

  const form = await context.request.formData();
  const id = String(form.get('id') ?? '').trim();

  if (!id) {
    return context.redirect('/admin/compose?error=' + encodeURIComponent('公開する下書きが指定されていません'));
  }

  try {
    await publishComposedDraft(id);
    return context.redirect('/admin/compose?published=1');
  } catch (err) {
    logger.error('Publish failed', { id, err: String(err) });
    return context.redirect('/admin/compose?error=' + encodeURIComponent(String(err).slice(0, 200)));
  }
};
```

- [ ] **Step 4: 型チェック**

Run: `cd /Users/will/aiblog && npx astro check 2>&1 | tail -5`
Expected: `0 errors`

- [ ] **Step 5: コミット**

```bash
cd /Users/will/aiblog
git add src/services/drafts/compose.ts src/pages/api/admin/compose-draft.ts src/pages/api/admin/compose-publish.ts
git commit -m "$(cat <<'EOF'
Add compose orchestrator and draft/publish endpoints

composeDraftForTopic chains research → ichikarablog voice retrieval →
draft → featured image → WordPress DRAFT, recording the result and its
cited URLs in composed_drafts. Research and image failures degrade
gracefully; the post is never auto-published. publishComposedDraft flips a
recorded draft to published over REST and is idempotent.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: ダッシュボードUIと最終検証

**Files:**
- Create: `src/pages/admin/compose/index.astro`
- Modify: `src/layouts/AdminLayout.astro:6`, `src/layouts/AdminLayout.astro:11-16`

**Interfaces:**
- Consumes: Task 5 の `POST /api/admin/compose-draft` と `POST /api/admin/compose-publish`、Task 1 の `composed_drafts` テーブル
- Produces: `/admin/compose` 画面

- [ ] **Step 1: ナビに追加する**

Modify `src/layouts/AdminLayout.astro` — `Props` の `activeNav` に `'compose'` を足す:

```typescript
interface Props {
  title: string;
  activeNav?: 'dashboard' | 'sources' | 'feed' | 'drafts' | 'compose' | 'settings';
}
```

`navItems` に1行足す（`drafts` の下）:

```typescript
const navItems = [
  { key: 'dashboard', href: '/admin',          label: 'ダッシュボード', icon: '◈' },
  { key: 'sources',   href: '/admin/sources',  label: 'ソース管理',     icon: '◎' },
  { key: 'feed',      href: '/admin/feed',     label: 'ニュースフィード', icon: '◷' },
  { key: 'drafts',    href: '/admin/drafts',   label: '下書き履歴',     icon: '◻' },
  { key: 'compose',   href: '/admin/compose',  label: '記事を書く',     icon: '✎' },
  { key: 'settings',  href: '/admin/settings', label: '設定',           icon: '⚙' },
] as const;
```

- [ ] **Step 2: compose画面を書く**

Create `src/pages/admin/compose/index.astro`:

```astro
---
import AdminLayout from '@/layouts/AdminLayout.astro';
import { getAdminClient } from '@/lib/supabase/server';

type ComposedRow = {
  id: string;
  topic: string;
  title: string;
  source_urls: { title: string; url: string }[] | null;
  wp_post_id: number | null;
  status: string;
  error: string | null;
  created_at: string;
  published_at: string | null;
};

const db = getAdminClient();
const { data } = await db
  .from('composed_drafts')
  .select('id, topic, title, source_urls, wp_post_id, status, error, created_at, published_at')
  .order('created_at', { ascending: false })
  .limit(50);

const rows = (data ?? []) as ComposedRow[];

const composed = Astro.url.searchParams.get('composed') === '1';
const published = Astro.url.searchParams.get('published') === '1';
const error = Astro.url.searchParams.get('error');

const ichikaraBase = (import.meta.env.ICHIKARA_WP_BASE_URL ?? '').replace(/\/$/, '');

const STATUS_LABEL: Record<string, string> = {
  draft: '下書き',
  published: '公開済み',
  failed: '失敗',
};
---

<AdminLayout title="記事を書く" activeNav="compose">
  {composed && (
    <div class="mb-4 px-4 py-2 rounded-md bg-score-highBg text-score-high text-sm">
      下書きを生成し、ichikarablogに保存しました。内容を確認して「公開」を押してください。
    </div>
  )}

  {published && (
    <div class="mb-4 px-4 py-2 rounded-md bg-score-highBg text-score-high text-sm">
      記事を公開しました。
    </div>
  )}

  {error && (
    <div class="mb-4 px-4 py-2 rounded-md bg-score-lowBg text-score-low text-sm">
      {error}
    </div>
  )}

  <!-- Compose form -->
  <section class="mb-8 bg-surface border border-border rounded-lg p-5">
    <h2 class="text-sm font-semibold text-text-primary mb-1">トピックから下書きを作る</h2>
    <p class="text-xs text-text-muted mb-4">
      Web検索で下調べし、あなたの過去記事の文体でichikarablogに下書きを保存します。公開はされません。
    </p>

    <form method="POST" action="/api/admin/compose-draft" class="space-y-3" id="compose-form">
      <div>
        <label for="topic" class="block text-xs font-medium text-text-secondary mb-1">トピック（必須）</label>
        <textarea
          id="topic"
          name="topic"
          rows="3"
          required
          placeholder="例: ADHDの当事者が使えるタスク管理の考え方を、最近の研究もふまえて書きたい"
          class="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-text-primary focus:outline-none focus:border-accent"
        ></textarea>
      </div>

      <div>
        <label for="angle" class="block text-xs font-medium text-text-secondary mb-1">切り口・補足（任意）</label>
        <input
          id="angle"
          name="angle"
          type="text"
          placeholder="例: 精神論ではなく仕組みの話にしたい"
          class="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-text-primary focus:outline-none focus:border-accent"
        />
      </div>

      <div>
        <label for="category" class="block text-xs font-medium text-text-secondary mb-1">カテゴリスラッグ（任意）</label>
        <input
          id="category"
          name="category"
          type="text"
          placeholder="例: adhd"
          class="w-full max-w-xs px-3 py-2 text-sm border border-border rounded-md bg-background text-text-primary focus:outline-none focus:border-accent"
        />
      </div>

      <button
        type="submit"
        id="compose-submit"
        class="px-4 py-2 text-sm rounded-md bg-accent text-white hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        下書きを生成
      </button>
      <p id="compose-progress" class="text-xs text-text-muted hidden">
        下調べ → 執筆 → ichikarablogへ保存。1〜3分ほどかかります。このページを閉じないでください。
      </p>
    </form>
  </section>

  <!-- Composed drafts -->
  <section>
    <h2 class="text-sm font-semibold text-text-primary mb-3">生成した下書き</h2>

    {rows.length === 0 ? (
      <p class="text-sm text-text-muted py-8 text-center">
        まだ下書きはありません。上のフォームからトピックを入力してください。
      </p>
    ) : (
      <div class="divide-y divide-border border border-border rounded-lg bg-surface">
        {rows.map(row => (
          <div class="p-4">
            <div class="flex items-start justify-between gap-4">
              <div class="min-w-0">
                <div class="flex items-center gap-2 mb-1">
                  <span class:list={[
                    'text-xs px-2 py-0.5 rounded',
                    row.status === 'published' ? 'bg-score-highBg text-score-high'
                      : row.status === 'failed' ? 'bg-score-lowBg text-score-low'
                      : 'bg-accent-light text-accent',
                  ]}>
                    {STATUS_LABEL[row.status] ?? row.status}
                  </span>
                  <span class="text-xs text-text-muted">
                    {new Date(row.created_at).toLocaleString('ja-JP')}
                  </span>
                  <span class="text-xs text-text-muted">
                    参照 {row.source_urls?.length ?? 0} 件
                  </span>
                </div>
                <p class="text-sm font-semibold text-text-primary leading-snug">{row.title}</p>
                <p class="text-xs text-text-muted mt-1 line-clamp-2">{row.topic}</p>
                {row.error && (
                  <p class="text-xs text-score-low mt-1">{row.error}</p>
                )}
              </div>

              <div class="flex items-center gap-2 flex-shrink-0">
                {row.wp_post_id !== null && ichikaraBase && (
                  <a
                    href={`${ichikaraBase}/wp-admin/post.php?post=${row.wp_post_id}&action=edit`}
                    target="_blank"
                    rel="noopener noreferrer"
                    class="text-xs text-accent border border-border rounded px-3 py-1.5 hover:bg-[#F0F0EE] transition-colors"
                  >
                    ichikaraで開く
                  </a>
                )}
                {row.wp_post_id !== null && row.status !== 'published' && (
                  <form method="POST" action="/api/admin/compose-publish">
                    <input type="hidden" name="id" value={row.id} />
                    <button
                      type="submit"
                      class="text-xs text-white bg-accent rounded px-3 py-1.5 hover:opacity-90 transition-opacity"
                    >
                      公開
                    </button>
                  </form>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    )}
  </section>
</AdminLayout>

<script>
  // Generation takes minutes — show progress and prevent a double submit.
  const form = document.getElementById('compose-form');
  const button = document.getElementById('compose-submit') as HTMLButtonElement | null;
  const progress = document.getElementById('compose-progress');

  form?.addEventListener('submit', () => {
    if (button) {
      button.disabled = true;
      button.textContent = '生成中…';
    }
    progress?.classList.remove('hidden');
  });
</script>
```

- [ ] **Step 3: 型チェック**

Run: `cd /Users/will/aiblog && npx astro check 2>&1 | tail -5`
Expected: `0 errors`

- [ ] **Step 4: 画面を目視確認する**

devサーバを起動し `/admin/compose` を開く（ログインが必要なら `/admin/login` を経由）。

確認項目:
- サイドバーに「記事を書く」が出て、選択状態になる
- フォームの3項目が表示される
- 下部が「まだ下書きはありません。」になっている

- [ ] **Step 5: E2E — トピックから下書きまで**

`/admin/compose` でトピックを入力して「下書きを生成」。1〜3分待つ。

確認項目:
1. 一覧に新しい行が「下書き」バッジ付きで出る
2. 「参照 N 件」の N が 1 以上（Web検索が効いている）
3. 「ichikaraで開く」からWordPress管理画面を開き、**status が下書き**であること
4. 本文末尾に「## 参考リンク」があり、リンクが実在すること
5. 本文の語り口がichikarablog寄りであること（ニュース解説調でない）
6. アイキャッチ画像が付いていること（失敗時は付かないが下書きは残る）

- [ ] **Step 6: E2E — 公開**

一覧の「公開」ボタンを押す。

確認項目:
1. 「記事を公開しました。」の緑帯が出る
2. バッジが「公開済み」に変わる
3. ichikarablog.com のフロントで記事が公開されている
4. **WordPressへのログインを一度も求められない**

- [ ] **Step 7: 回帰確認 — AIおじさん側が無傷であること**

確認項目:
1. `http://localhost:4321/` のトップが従来通り表示される
2. `/admin/drafts` が従来通り表示される
3. クロンが壊れていないこと:

```bash
cd /Users/will/aiblog
SECRET=$(grep '^CRON_SECRET=' .env | cut -d= -f2-)
curl -s "http://localhost:4321/api/cron/process-articles?cron_secret=$SECRET" | head -c 400
```

Expected: `{"ok":true,...}` が返る（新規公開が起きなくてもよい）。

- [ ] **Step 8: コミット**

```bash
cd /Users/will/aiblog
git add src/pages/admin/compose/index.astro src/layouts/AdminLayout.astro
git commit -m "$(cat <<'EOF'
Add the compose dashboard for topic-directed drafts

New /admin/compose screen: a topic form that kicks off research and
drafting, and a list of composed drafts showing status, cited-source count,
a link into ichikarablog's editor, and a 公開 button that publishes over
REST. Adds the screen to the admin nav.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: 仕上げ — Vercel環境変数とマージ

**Files:**
- なし（設定と統合のみ）

**Interfaces:**
- Consumes: Task 1〜6 のすべて
- Produces: 本番で動く `/admin/compose`

- [ ] **Step 1: Vercelに環境変数を入れるようユーザーに依頼する**

ユーザーに次を依頼する（**実行者が代行しないこと**）:
Vercel プロジェクトの Environment Variables に、Production/Preview 両方へ追加:
- `ICHIKARA_WP_BASE_URL`
- `ICHIKARA_WP_USERNAME`
- `ICHIKARA_WP_APP_PASSWORD`

- [ ] **Step 2: 最終型チェック**

Run: `cd /Users/will/aiblog && npx astro check 2>&1 | tail -5`
Expected: `0 errors`

- [ ] **Step 3: ブランチを仕上げる**

REQUIRED SUB-SKILL: `superpowers:finishing-a-development-branch` を使い、mainへの統合方法をユーザーに確認する。ユーザーの承認なしにpushしない。

- [ ] **Step 4: デプロイ後の本番スモークテスト**

デプロイ完了後、本番の `/admin/compose` で短いトピックを1本生成し、下書きがichikarablogに立つことと「公開」が効くことを確認する。

---

## Self-Review

**1. Spec coverage**

| Spec要件 | 対応タスク |
|---|---|
| `/admin/compose` でトピック入力 → 下書き生成 | Task 6 |
| Web検索で下調べ＋参照URL | Task 4（researchTopic）＋Task 5（本文に参考リンク） |
| ichikarablog文体コーパス | Task 1（corpus列）＋Task 3（取り込み・検索） |
| ichikarablogへ **draft** 投稿 | Task 2（target）＋Task 5（status='draft'固定） |
| ダッシュボードから公開・WPログイン不要 | Task 2（publishWordPressPost）＋Task 5（publishComposedDraft）＋Task 6（公開ボタン） |
| アイキャッチ毎回自動生成 | Task 5（generateAndAttachFeaturedImage） |
| `composed_drafts` テーブル | Task 1 |
| `ICHIKARA_WP_*` env | Task 1（スキーマ）＋Task 7（Vercel） |
| エラー処理（研究失敗/投稿失敗/画像失敗/公開冪等） | Task 5 |
| 既存パイプライン無改変 | Task 2・3 の optional 引数、Task 6 Step 7 の回帰確認 |
| 検証は astro check ＋手動E2E | 各タスクの型チェックステップ、Task 6 Step 5-7 |

漏れなし。

**2. Placeholder scan**

"TBD"/"TODO"/"適切に処理"/"Task Nと同様" は不使用。コードを変更する全ステップに実コードを掲載済み。

**3. Type consistency**

- `WordPressTarget` — Task 2 で定義、Task 3・5 で同名利用。
- `resolveWordPressTarget(name?)` — Task 2 の既定値 `'aiojisan'`、Task 5 は `'ichikarablog'` を明示。
- `getStyleChunksForDraft(title, topics, corpus?)` — Task 3 で第3引数追加、Task 5 で3引数呼び出し。既存 `content.ts` の2引数呼び出しは互換。
- `ingestBlogPosts(posts, corpus?)` — Task 3 で戻り値を `void` → `Promise<number>` に変更し、Task 3 の `ichikara-import.ts` が `chunks` として受け取る。既存呼び出し元は戻り値を使っていないため互換。
- `ICHIKARA_CORPUS` — Task 3 で export、Task 5 で import。
- `ResearchSource` / `TopicDraftInput` — Task 4 で `src/types/ai.ts` に定義、Task 4・5 で同名利用。
- `publishWordPressPost(postId, target?)` — Task 2 で定義、Task 5 で2引数呼び出し。
- `composed_drafts` の列名 — Task 1 のDDLと、Task 5 のinsert・Task 6 のselectが一致（`error` 列を含む）。

不整合なし。
