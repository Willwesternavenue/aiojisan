# 過去記事のバックデート公開（停止期間の取りこぼし20本）— 設計

日付: 2026-07-03

## 背景・目的

OpenAI クレジット切れにより 2026-06-21〜07-02 の約12日間、採点（scoring）が停止し、その間フェッチした記事（約2,672件）が自動公開されなかった。この期間の良質な記事を **20本**、遡って WordPress に **原記事の公開日でバックデート公開**したい。X投稿はせず、日次公開上限もバイパスする一回限りの手動オペレーション。

## 前提データ（確認済み）

- 停止期間内で **すでに採点済み（insights あり）の記事は139件**。スコア分布: ≥8.5=2, 8.0-8.4=26, 7.5-7.9=78。
- 上位20本はすべて **総合スコア 8.0 以上**（通常の自動公開基準8.5に近い高品質）。
- 大半が `published_at`（原公開日）を保持。無い場合は `fetched_at` にフォールバック。

→ **採点済みの中から上位20本**を選べば十分。追加の採点は不要（insights が既にあるため下書き生成もそのまま高品質で動く）。

## 方針サマリ

- **選定**: 停止期間（fetched_at 6/21〜7/2）で insights を持つ記事を `overall_score` 降順に並べ、**上位20本**。
- **バックデート**: 各記事の `published_at`（無ければ `fetched_at`）を WordPress の投稿日に設定。
- **生成品質**: 既存の `generateDraftForArticle` をそのまま再利用（文体RAG・正確なプロンプト・カテゴリ・Gemini画像すべて適用）。
- **X投稿しない**、**日次上限バイパス**。
- **必須の安全ゲート**: 公開前に対象20本（順位・スコア・バックデート日・タイトル）を提示し、承認を得てから実行。

## アーキテクチャ（Approach A：既存生成ロジックの再利用）

### 1. WordPress クライアント — `src/services/wordpress/client.ts`

`createWordPressDraft(...)` に**任意引数 `publishDate?: string`（ISO文字列）**を追加。
- 指定時、WP 投稿ペイロードに `date_gmt`（`publishDate` を UTC の `YYYY-MM-DDTHH:MM:SS` 形式に整形）を含める。WordPress は過去日付＋`status: 'publish'` の投稿を、その日付でバックデート公開する。
- 未指定時は現状どおり（date 未設定＝現在時刻）。

### 2. ドラフト生成オーケストレータ — `src/services/drafts/generate.ts`

`generateDraftForArticle(articleId, options)` の `options` に追加:
- `publishDate?: string` — `createWordPressDraft` にそのまま渡す。
- `skipSocial?: boolean` — true のとき X 投稿ブロックをスキップ。

変更点:
- 既存の X 投稿ブロックを `if (autoPublish && !skipSocial)` で囲む。
- `createWordPressDraft(..., publishDate)` を渡す。
- `generation_metadata` に `backfilled: true`（`publishDate` 指定時）を記録。
- 既存の「下書きが既にあればスキップ」ガードはそのまま（**冪等**：再実行で二重公開しない）。

### 3. 管理APIエンドポイント — `src/pages/api/admin/backfill-article.ts`（新規）

- `POST`。**認証必須**：既存の cron 認証ヘルパー（`requireCronAuth`、`CRON_SECRET` 検証）を再利用（本番公開を行う機微なエンドポイントのため、無認証の既存adminルートとは分けて保護する）。
- 入力: `article_id`（form or JSON）。
- 処理: 記事を取得し `publishDate = published_at ?? fetched_at` を決定 → `generateDraftForArticle(articleId, { autoPublish: true, publishDate, skipSocial: true })`。
- 返却: JSON（`{ ok, wpPostId }` または `{ ok:false, error }`）。1リクエスト1記事（約30〜40秒。`maxDuration:300` 内）。

### 4. ローカル・オーケストレータ — `scripts/backfill-past-articles.mjs`（新規・Node）

- `.env` を読み込み、Supabase から**停止期間の採点済み記事を `overall_score` 降順で上位20本**取得。
- **ドライラン（既定）**: 20本を「順位・スコア・バックデート日・タイトル」で標準出力に表示して終了。**副作用なし**。
- **実行（`--execute`）**: 各記事を順に、本番の `/api/admin/backfill-article` へ `CRON_SECRET` 付きで POST（逐次、1本ずつ）。各結果をログ出力。
- デプロイ済みエンドポイントを叩くため、**2・3のコード変更をデプロイした後**に実行する。

## データフロー

選定(ローカル・Supabase) → ドライラン提示 → **承認** → スクリプトが20本を順に本番エンドポイントへ → 各記事で下書き生成＋画像＋バックデート公開 → `generated_drafts`/`article_actions` に記録。公開済み記事は一覧（ページング済み）に原公開日の位置で並ぶ。

## エラー処理・安全性

- **ドライラン承認ゲート**が最重要。承認まで1本も公開しない。
- 冪等：既に下書きがある記事はスキップ。再実行安全。
- 1本の失敗は他に波及しない（スクリプトが逐次処理＋各結果ログ）。まず1本だけ実行して結果を確認（カナリア）してから残りを流す運用を推奨。
- エンドポイントは `CRON_SECRET` で保護。

## 検証

テスト基盤なし（`astro check` のみ）。
- `astro check` で型確認（`generateDraftForArticle`/`createWordPressDraft` のオプション追加、新エンドポイント）。
- スクリプトの**ドライラン出力**で対象20本を目視。
- **カナリア**：`--execute` で最初の1本だけ通し、WordPress で「バックデート日で公開・本文・画像・カテゴリ」が正しいか確認 → 問題なければ残りを実行。

## スコープ外（YAGNI）

- 停止期間の全記事の再採点（採点済み139本で足りる）。
- 恒久的な管理UI（一回限りのため。エンドポイントとスクリプトのみ）。
- X への遡及投稿。

## 既知の前提・留意

- 選定は「採点済み139本の上位20本」であり「全2,672本の上位20本」ではない。ただし上位20本は全て8.0以上で十分高品質。
- バックデート公開は過去日付になるため、RSS/サイトマップ上も過去位置に入る（新着通知的な露出は少ない）。ニュース鮮度の観点でも妥当。
