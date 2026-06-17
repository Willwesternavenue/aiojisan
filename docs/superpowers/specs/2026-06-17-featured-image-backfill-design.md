# アイキャッチ画像のバックフィル（一括・上限付き）— 設計

日付: 2026-06-17

## 背景・目的

アイキャッチ画像は自動公開時に Gemini (`gemini-3-pro-image-preview`) で生成し WordPress に添付する。生成失敗は `generateDraftForArticle` 内で try/catch により握りつぶされ、記事はプレースホルダ画像のまま公開される。Gemini の前払いクレジットが枯渇していた期間、多数の記事が画像なし（プレースホルダのまま）で公開された。クレジット補充後、それらに画像を後付けするのが本機能の目的。

関連: 画像生成本体 `generateAndAttachFeaturedImage`（`src/services/wordpress/client.ts`）は復旧確認済み。作成時のプレースホルダは `PLACEHOLDER_MEDIA_ID = 125`。

## 方針サマリ

- **検出**: `featured_media === PLACEHOLDER_MEDIA_ID (125)` のまま公開されている記事＝画像生成に失敗した記事。日付範囲ではなくこの一致で正確に拾う。
- **実行**: 管理画面のボタン1つで一括実行。**1回あたり最大10件**（過剰課金・暴走防止）。残り件数を表示し、再クリックで次バッチ。
- **再利用**: 既存の `generateAndAttachFeaturedImage` をそのまま使う。
- **冪等**: 画像が付くと `featured_media !== 125` になり、次回の検出対象から自動的に外れる。

## アーキテクチャ（3層・既存パターン踏襲）

### 1. WordPress クライアント — `src/services/wordpress/client.ts`（追記）

`listPublishedPostsWithPlaceholderImage(): Promise<PlaceholderPost[]>`
- `PlaceholderPost = { id: number; title: string; summary: string; slug: string }`
- WordPress REST `/posts?status=publish&per_page=100&_fields=id,title,excerpt,slug,featured_media&page=N` をページング取得（`batch.length < 100` で終了）。
- `featured_media === PLACEHOLDER_MEDIA_ID` の投稿だけ抽出。
- `title` は `title.rendered`、`summary` は `excerpt.rendered` から **HTMLタグを除去**して返す（画像プロンプト用。`generateAndAttachFeaturedImage` 内で 150 字にスライスされる）。
- WP REST の詳細とプレースホルダIDをこの関数内に閉じ込める。

### 2. サービス層 — `src/services/images/backfill.ts`（新規）

`backfillMissingFeaturedImages(limit?: number): Promise<BackfillResult>`
- `const BACKFILL_LIMIT = 10`（`limit` 省略時の既定）。
- 手順:
  1. `listPublishedPostsWithPlaceholderImage()` で対象一覧を取得（`totalMissing = 件数`）。
  2. 先頭 `limit` 件について、各 `generateAndAttachFeaturedImage(post.id, post.title, post.summary, post.slug)` を順に await。
  3. 各件を try/catch で集計（1件失敗しても続行、失敗は warning ログ）。
  4. 返す: `BackfillResult = { totalMissing: number; succeeded: number; failed: number; remaining: number }`（`remaining = totalMissing - succeeded`）。

### 3. API ルート — `src/pages/api/admin/images/backfill.ts`（新規）

既存 `src/pages/api/admin/drafts/regenerate.ts` と同形:
- `export const POST: APIRoute`
- `backfillMissingFeaturedImages()` を呼ぶ。
- 成功時 `/admin/drafts?img_done=<succeeded>&img_fail=<failed>&img_left=<remaining>` へ `redirect`。
- 失敗時 500 とエラーメッセージ。

### 4. UI — `src/pages/admin/drafts/index.astro`（追記）

- 一覧上部にボタン（`<form method="POST" action="/api/admin/images/backfill">` ＋ submit「画像が無い記事に一括生成（最大10件）」）。
- リダイレクトのクエリ（`img_done` / `img_fail` / `img_left`）を読み、結果バナーを表示（例: 「3件に画像を生成しました（失敗0／残り5）」）。残りがあれば「もう一度押すと続きを処理」と案内。

## データフロー

ボタン押下 → 同期 POST → WPで対象検出 → 先頭最大10件を Gemini 生成＆WP添付（数十秒、Vercel 既定 300s 以内）→ 結果バナー付きで一覧へリダイレクト。

## エラー処理・安全性

- 1回上限10件で過剰課金・暴走を防止。残り件数を提示し、利用者が再クリックで継続。
- 1件の生成失敗は他に波及させない（集計して表示）。
- クレジット切れ等で全件失敗しても記事本体は無傷（featured_media 添付のみ失敗）。
- 冪等: 添付済みは次回検出されない。

## スコープ外（YAGNI）

- 日付範囲指定、自動/定期バッチ化、プレースホルダ以外の判定基準。
- 実行前の対象件数のプリカウント表示（ページ読込が重くなるため。件数は実行後のバナーで把握）。

## 既知の前提・留意

- `/api/admin/*` は middleware（`/admin/*` のみ保護）の対象外で現状未認証。既存パターン踏襲。認証ギャップは別タスク。
- テスト基盤は無い（`astro check` の型チェックのみ）。本機能もテストは追加せず、`astro check` ＋ dev サーバでの1バッチ実行＋画像添付の目視で検証する。
