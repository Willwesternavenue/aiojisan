# 第4ピラー「海外AIビジネス」＋スタートアップ解剖シリーズ＋ソース追加 — 設計

日付: 2026-07-08

## 背景・目的

サイトの編集軸は3本柱（フィジカルAI／AI駆動開発／生成AIニュース）で、パイプライン全体（キーワード判定・採点プロンプト・日次バランス・表示・ハッシュタグ・画像ルーティング）に配線されている。ここに「**海外AIビジネス**」（海外AI企業・スタートアップの収益モデル・資金調達・市場構造を、「日本でやるならどうなる？」の視点で解説する枠）を第4ピラーとして追加する。「**スタートアップ解剖**」はピラーではなく**記事の型（シリーズ）**として執筆プロンプトに条件付きで組み込む（海外AIビジネス記事の全てがスタートアップ深掘りとは限らないため）。

急所: 採点プロンプトには「3本柱のどれにも明確に属さない場合、overall_score は最大7.4」という減点ルールがあり、プロンプトを更新しない限り新カテゴリ記事は自動公開しきい値8.5に永遠に届かない。

あわせて、この枠に直球で合う**検証済みRSSソース4本**を追加する（フィード有効性は実フェッチで確認済み）。

## 方針サマリ

1. `overseas-ai-business` を **PILLAR_CATEGORIES の3番目**（生成AIニュースの前）に追加。
2. 採点プロンプトを「4本柱」に更新（説明追加＋7.4キャップ文言更新）。
3. 執筆プロンプトに**内容駆動**の「スタートアップ解剖」指示を追加（特定AI企業1社の深掘り記事のときのみ発動）。
4. 表示用カテゴリ定義（2ページに重複）を pillars.ts からの export に一元化。
5. 機械的追随: 日次バランス `byPillar`・Xハッシュタグ。画像ルーティングと日次上限は変更なし。
6. ソース4本をデータ投入（コード変更なし・1回スクリプト）。

## 変更詳細

### 1. `src/services/editorial/pillars.ts`

- `PillarSlug` union に `'overseas-ai-business'` を追加。
- `PILLAR_CATEGORIES` の**3番目**（`generative-ai-news` の直前）に挿入:
  - name: `海外AIビジネス`
  - description: `海外AI企業・スタートアップの収益モデル、資金調達、M&A、市場構造に関する記事`
  - keywords: `資金調達`, `funding`, `raises`, `series a`, `series b`, `series c`, `valuation`, `評価額`, `ipo`, `m&a`, `買収`, `acquisition`, `startup`, `スタートアップ`, `y combinator`, `vc`, `venture capital`, `ベンチャーキャピタル`, `ビジネスモデル`, `収益モデル`, `arr`, `unicorn`, `ユニコーン`, `crunchbase`
- 並び順の意味: `detectPillarCategories` は定義順で返し、呼び出し側は `[0]` を主カテゴリ（WPカテゴリ先頭・画像ルーティング・ハッシュタグ順）に使う。「AI開発ツール企業の資金調達」はAI駆動開発が主・海外AIビジネスが副となる（意図どおり）。
- **表示用リストの一元化**: `EDITORIAL_DISPLAY_CATEGORIES`（`{ slug, label, description }` の配列、表示コピーは現行2ページのものをベースに4本目を追加）を pillars.ts から export し、`src/pages/articles/index.astro` と `src/pages/index.astro` の重複ローカル定義 `EDITORIAL_CATEGORIES` を置き換える。表示順は現行踏襲（生成AIニュース→AI駆動開発→フィジカルAI→海外AIビジネス）。
  - 海外AIビジネスの表示 description: `海外AI企業の収益モデル、資金調達、スタートアップの勝ち筋`

### 2. `src/services/ai/prompts.ts`（SCORE_ARTICLE_PROMPT）

- 「サイトの3本柱は…」→「サイトの4本柱は「生成AI一般ニュース」「AI駆動開発」「フィジカルAI/ロボティクス」「海外AIビジネス」」に変更し、説明行を追加:
  - `- 海外AIビジネス: 海外AI企業・スタートアップの収益モデル、資金調達、M&A、市場構造、日本市場への示唆`
- 減点ルール「3本柱のどれにも明確に属さない場合、overall_scoreは最大7.4」→「4本柱の…」に変更。
- 「8.5〜9.1: …3本柱に明確に合い…」の「3本柱」も「4本柱」に変更。

### 3. `src/services/ai/prompts.ts`（GENERATE_BLOG_DRAFT_PROMPT）— スタートアップ解剖

「## 記事構成」セクションの後に条件付きブロックを追加:

```
## シリーズ「スタートアップ解剖」（該当時のみ）
元記事が特定の海外AI企業・スタートアップ1社の深掘り（事業内容・資金調達・成長理由の分析）である場合のみ、以下に従う。
- titleOptions はいずれも「スタートアップ解剖：」で始める（例: スタートアップ解剖：Lovableはなぜ13Bドル評価なのか）
- 本文の見出し構成を「何をしている会社か」「なぜ伸びているのか」「収益モデル」「日本での応用可能性」とする
市場動向・資金調達統計・複数企業の話題など、1社の深掘りでない記事にはこの指示を適用しない。
```

### 4. Xハッシュタグ（`src/services/drafts/generate.ts` getHashtags）

`if (category.slug === 'overseas-ai-business') tags.add('#AIビジネス');` を追加。SCORE/X プロンプト内のハッシュタグ例（`#生成AI #AI駆動開発 #フィジカルAI`）はそのまま（例示であり網羅ではない）。

### 5. 日次バランス（`src/pages/api/cron/process-articles.ts`）

`getPublishStatsToday` の `byPillar` 初期化に `'overseas-ai-business': 0` を追加（`Record<PillarSlug, number>` 型が4本目を要求するため必須）。**新ピラー専用の日次上限は設けない**（`DAILY_PHYSICAL_AI_TARGET` のような枠は追加しない。総枠 `DAILY_AUTO_PUBLISH_TARGET = 5` は不変）。

### 6. 画像ルーティング（変更なし）

`provider.ts` は `ai-driven-development` のみOpenAIで他はGemini既定。`overseas-ai-business` は既定（Nano Banana Pro）に落ちるため変更不要。

### 7. ソース追加（データ投入・コード変更なし）

検証済み（2026-07-08 実フェッチでXML確認）の4本を `sources` に insert する冪等スクリプト `scripts/add-overseas-sources.mjs` を作成しコミットする（`scripts/backfill-past-articles.mjs` と同じ流儀）。実行はローカルから1回:

| name | list_url | base_url | priority | tags |
|---|---|---|---|---|
| Crunchbase News | https://news.crunchbase.com/feed/ | https://news.crunchbase.com | 6 | {海外AIビジネス} |
| CB Insights Research | https://www.cbinsights.com/research/feed/ | https://www.cbinsights.com | 6 | {海外AIビジネス} |
| Sifted AI | https://sifted.eu/sector/artificial-intelligence/feed | https://sifted.eu | 5 | {海外AIビジネス} |
| Ben's Bites | https://www.bensbites.com/feed | https://www.bensbites.com | 5 | {海外AIビジネス} |

すべて `source_type='rss'`, `enabled=true`。**重複ガード**: insert 前に同一 `list_url` の存在チェック（再実行安全）。投入後は15分毎の fetch-sources cron が自動収集。

## エラー処理・安全性

- コード変更はすべて既存パターンへの追加であり、既存3ピラーの判定・表示・公開挙動は不変（キーワード追加による誤判定の可能性は運用で監視）。
- WordPressカテゴリ「海外AIビジネス」は初回マッチ記事の公開時に `getOrCreateWordPressCategory` が自動作成。手作業不要。
- ソース投入スクリプトは冪等（list_url 重複スキップ）。

## 検証

- `npx astro check` 0 errors。
- dev で `/articles` と `/`（トップ）にカテゴリピル4本目が出ること（記事0件のうちはWPカテゴリ `count=0` のためピル非表示 — これは既存仕様（count>0のみ表示）どおりで正常）。
- ソース投入後、Supabase `sources` に4行、次回cron後 `source_runs` に成功ランがあること。
- 実運用の答え合わせ（数時間〜1日）: 新ソースの記事が採点され、`overseas-ai-business` として公開されること。

## スコープ外（YAGNI）

- 新ピラー専用の日次上限・画像モデル割当。
- The Information / a16z / FutureTools / TLDR AI 等のRSS非対応ソース（公式フィードなし）。
- 「スタートアップ解剖」のWordPressタグ機能化（見出しパターンのみ）。
- 過去記事の再分類。
