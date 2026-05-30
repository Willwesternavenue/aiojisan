# 既存記事の再生成（ワンクリック上書き）— 設計

日付: 2026-05-30

## 背景・目的

ブログ本文生成は Claude Sonnet 4.6 に切り替え済みだが、過去に旧プロンプト（短い字数指定・低い `max_tokens`）で生成された記事は内容が薄い。Search Console 上、これらの薄い記事や WordPress バックエンド重複により「クロール済み - インデックス未登録」が発生していた。wp 重複と非www正規化は別途対応済み。本機能は残る課題として、**既存の薄い記事を新プロンプトで作り直し、同じURLのまま本文を厚くする**ことで、インデックス性と検索品質を底上げする。

関連: 本文厚み修正（プロンプト `2800〜4000字` / `max_tokens 8192`）は実装・反映済み。これは新規生成にしか効かないため、既存記事には本機能で遡及適用する。

## 方針サマリ

- **対象**: 管理画面から人が手動で選んだ記事のみ（一括・自動化はしない）
- **挙動**: ワンクリックで生成 → そのまま WordPress 本文を上書き（差分プレビューなし）
- **不変条件**: WordPress の post ID・slug・タイトルは維持し、**本文（content）のみ差し替え**。URL の SEO 資産を壊さない
- **再実行しないもの**: アイキャッチ画像生成、X 投稿（既に公開済みのためコスト最小化）

## アーキテクチャ（3層・既存パターン踏襲）

### 1. サービス層 — `src/services/drafts/regenerate.ts`（新規）

`regenerateDraftForArticle(articleId: string): Promise<{ wpPostId: number }>`

処理順:
1. `generated_drafts` から該当 `article_id` の最新行を取得し、`wordpress_post_id` と `draft_title` を得る。`wordpress_post_id` が無ければエラー（再生成対象でない）
2. `articles`＋`article_ai_insights` を取得（記事が無ければエラー）
3. `getStyleChunksForDraft(title, topics)` で文体チャンク取得
4. `ai.generateBlogDraft({...})` で新ドラフトを生成
5. `updateWordPressDraft(wordpress_post_id, 既存draft_title, 新draft.body)` で本文のみ上書き（タイトルは既存値を渡して不変）
6. `generated_drafts` の該当行を更新: `draft_body`、`draft_outline`、`generation_metadata`（`model: draft.model`、`regenerated: true`、`regenerated_at`）
7. `article_actions` に `{ article_id, action_type: 'regenerate_blog_draft' }` を記録

共通化: 手順 2〜4（記事取得 → 文体チャンク → `ai.generateBlogDraft`）は既存 `generateDraftForArticle`（`src/services/drafts/generate.ts`）と重複するため、小さなヘルパー（例: `buildBlogDraftForArticle(article, insights)`）として抽出し、生成・再生成の両方から呼ぶ。既存 `generateDraftForArticle` の挙動は変えない（リファクタは生成部の抽出のみ）。

### 2. API ルート — `src/pages/api/admin/drafts/regenerate.ts`（新規）

既存 `src/pages/api/admin/articles/generate-draft.ts` と同形:
- `export const POST: APIRoute`
- `formData` から `article_id` を取得。無ければ 400
- `regenerateDraftForArticle(articleId)` を呼ぶ
- 成功時 `/admin/drafts?regenerated=1` へ `redirect`
- 失敗時 500 とエラーメッセージ（既存テンプレ準拠）。本文上書きは生成成功後にのみ実行するため、失敗時は WordPress 記事は元のまま

### 3. UI — `src/pages/admin/drafts/index.astro`（既存に追記）

- 各 draft 行のうち `wordpress_post_id` を持つものに「再生成」ボタンを追加
- `<form method="POST" action="/api/admin/drafts/regenerate">` ＋ hidden `article_id`（`draft.article_id`）＋ submit ボタン
- 成功リダイレクト時（`?regenerated=1`）に簡易成功バナーを表示

## データフロー

ボタン押下 → 同期 POST → Claude 生成（〜十数秒。Vercel 既定タイムアウト 300s 内）→ WordPress 本文上書き → DB 更新 → 一覧へリダイレクト＋成功バナー。

## エラー処理

- 生成失敗・WordPress 更新失敗は 500 を返す。生成成功後にのみ上書きするため、途中失敗で記事が壊れることはない
- `wordpress_post_id` 不在・記事不在は明示的にエラーを返す

## テスト方針

- `regenerateDraftForArticle` の単体テスト: WordPress クライアントと AI プロバイダをモックし、(a) 既存タイトルが維持され body のみ更新されること、(b) `wordpress_post_id` 不在時にエラーになること、(c) `generated_drafts` と `article_actions` が更新されることを検証
- 抽出ヘルパー `buildBlogDraftForArticle` を生成・再生成が共有しても既存生成フローが壊れないことを確認

## スコープ外（YAGNI）

- 差分プレビュー → 反映の 2 段階フロー
- 一括／自動再生成、スコア閾値による対象自動抽出
- 人手による WordPress 側編集の検知・保護（手動選択のため人の判断に委ねる）
- タイトル・slug の作り直し

## 既知の前提・留意

- `/api/admin/*` は middleware（`/admin/*` のみ保護）の対象外で、現状認証保護されていない。本機能は既存パターンを踏襲するが、この認証ギャップ自体は別タスクで対処すべき既存の問題。
- 再生成は人手編集を上書きしうる。手動選択前提のため許容。
