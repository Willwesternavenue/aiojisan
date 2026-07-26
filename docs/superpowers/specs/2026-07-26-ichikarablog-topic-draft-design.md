# ichikarablog トピック指示ドラフト生成 — 設計

- **日付**: 2026-07-26
- **状態**: 承認済み（実装計画へ）
- **著者**: tachiiri + Claude

## 目的

AIおじさんの自動ニュースブログの仕組み（文体RAG・Claudeによる構造化ドラフト生成・WordPress
REST投稿・アイキャッチ生成）を流用し、**トピックを指示するとあなたの個人ブログ
（ichikarablog.com）用のドラフトを生成し、下書き保存だけ行う**仕組みを作る。

公開はAIおじさんのダッシュボードから自分の操作で行い、**WordPressにログインしない**
（アプリケーションパスワード経由のREST操作で2要素認証を回避する）。

### 成功条件

1. `/admin/compose` でトピックを入力すると、Web検索で下調べした内容＋参照URLを含み、
   あなたのichikarablog文体に寄せた本文ドラフトが生成される。
2. そのドラフトがichikarablog.comに **status=draft** で投稿される（自動公開しない）。
3. ダッシュボードの「公開」ボタンで、WordPressにログインせずに draft→publish できる。
4. 既存のAIおじさんのニュースパイプラインの挙動は一切変わらない（回帰なし）。

## 非目標（YAGNI）

- スケジュール実行・トピックキュー（MVPでは都度手動投入）。
- 自動公開・X等のSNS投稿（compose経路では一切行わない）。
- 複数の個人ブログ対応（投稿先はichikarablog 1つ。将来拡張できる抽象化だけ用意する）。

## 前提（確定事項）

- 投稿先: `ichikarablog.com`（AIおじさんとは別サイト、self-hosted、wp-json REST有効）。
  アプリケーションパスワード発行可。
- 文体: ichikarablogの既存記事（約1000本）を取り込んだ専用コーパスを主軸にする。
  既存のAIおじさん文体コーパス（元々ユーザーの声由来）を補助レンズとして混ぜるのは可だが、
  MVPではichikarablogコーパスのみ使用（B混在は後付け可能なオプションとする）。
- 下調べ: **Anthropic内蔵Web検索ツール**を使う（新しい検索業者・APIキーを増やさない）。
- アイキャッチ: 既存のGemini/OpenAI画像パイプラインを流用し、**毎回自動生成**する。

## アーキテクチャ / データフロー

### 生成フロー

`/admin/compose`（AIおじさんダッシュボード、admin session認証）でトピックを入力し、
`POST /api/admin/compose-draft` を呼ぶ。バックエンド処理:

1. **下調べ** (`services/research/websearch.ts`): Claude＋Web検索ツールでトピックを調査し、
   `{ findings: string, sources: { title: string; url: string }[] }` を返す。
2. **文体取得**: `getStyleChunksForDraft(topic, topics)` を `corpus='ichikarablog'` で実行し、
   トピックに近い文体チャンクを取得する。
3. **ドラフト生成** (`generateTopicDraft`): トピック執筆用の新プロンプトで、あなたの声＋調査要点を
   元に titleOptions / slug / outline / body を生成する。本文末尾に**参考リンク**セクションを差し込む。
4. **アイキャッチ生成**: 既存画像パイプラインで生成する（失敗時は画像なしで続行）。
5. **ichikarablogへ下書き投稿**: 投稿先を差し替えたWPクライアントで status=`draft` として投稿する。
   カテゴリ・アイキャッチ・参考リンクを含める。
6. **記録**: `composed_drafts` テーブルに保存する。

### 公開フロー

- `/admin/compose` の一覧から「公開」ボタン → `POST /api/admin/compose-draft/publish`。
- ichikarablog側のWP投稿を REST（アプリパス）で draft→publish に反転する。
- `composed_drafts.status` を `published`、`published_at` を記録する。
- 冪等: すでに published なら no-op。

## コンポーネント

### 新規

| ファイル | 役割 | 依存 |
|---|---|---|
| `services/wordpress/target.ts` | `WordPressTarget` 型と投稿先解決（既定=AIおじさんenv、`ichikarablog`=`ICHIKARA_WP_*`） | env |
| `services/research/websearch.ts` | Anthropic Web検索でトピック調査 → `{findings, sources}` | Anthropic SDK |
| `services/drafts/compose.ts` | オーケストレータ `composeDraftForTopic(input)`（1〜6を束ねる） | 上記＋既存draft/image |
| `services/ai/prompts.ts`（追記） | トピック執筆プロンプト（ニュース解説ではなく「与えられたトピックについて自分の声で書く」） | — |
| `services/ai/anthropic.ts`（追記） | `generateTopicDraft(input)`（tool-useで構造化出力、既存 `generateBlogDraft` と同型） | — |
| `pages/api/admin/compose-draft.ts` | 生成エンドポイント（POST） | compose.ts |
| `pages/api/admin/compose-draft/publish.ts` | 公開エンドポイント（POST） | target.ts |
| `pages/admin/compose/index.astro` | 生成フォーム＋生成済み一覧UI | 上記API |
| ichikarablogコーパス取り込み | 一回限りのバッチ（`ICHIKARA_WP_*`から〜1000本を取得→チャンク→埋め込み→`corpus='ichikarablog'`で保存） | rag/ingest.ts |

### 変更

| ファイル | 変更内容 | 後方互換 |
|---|---|---|
| `services/wordpress/client.ts` | `createWordPressDraft` 等に任意の `target?: WordPressTarget` 引数を追加。未指定なら従来のAIおじさんenvを使う | 既存呼び出しは無改変で従来動作 |
| `services/rag/retrieval.ts` | `getStyleChunksForDraft(..., corpus?)` を追加。既定 `'aiojisan'` | 既存呼び出しは既定コーパスで従来動作 |
| `services/rag/ingest.ts` | ingest対象の `corpus` と取得元WP targetをパラメータ化 | 既存挙動は既定値で不変 |

## データモデル

### `blog_style_chunks`（変更）

- カラム追加: `corpus text not null default 'aiojisan'`
- 既存行は自動的に `'aiojisan'` になる（従来のRAGは無改変で動く）
- RPC `match_blog_chunks` に任意フィルタ `p_corpus text default null` を追加
  （null=全コーパス、指定時はそのコーパスに限定）

### `composed_drafts`（新規）

| カラム | 型 | 備考 |
|---|---|---|
| id | uuid pk | |
| topic | text not null | 入力トピック |
| angle | text null | 任意の切り口・指示 |
| title | text not null | 採用タイトル |
| outline | text null | |
| body | text not null | 生成本文（マークダウン） |
| source_urls | jsonb not null default '[]' | 参照URL `[{title,url}]` |
| wp_target | text not null | `'ichikarablog'` |
| wp_post_id | int null | ichikarablog側の投稿ID |
| category | text null | ichikarablogのカテゴリ |
| status | text not null | `draft` / `published` / `failed` |
| created_at | timestamptz default now() | |
| published_at | timestamptz null | 公開ボタン押下時刻 |

マイグレーションは `supabase/migrations/` に連番で追加する。

## UI（`/admin/compose`）

- **上部: 生成フォーム**
  - トピック（textarea, 必須）
  - 切り口・補足（任意）
  - ichikarablogカテゴリ（任意, select）
  - [生成] ボタン。押下後は進捗（調査 → 執筆 → 投稿）を表示する。
- **下部: 生成済み一覧**
  - 各行: タイトル / トピック / 日付 / ステータスバッジ / 参照URL数 /
    [プレビュー] [公開] [ichikaraで開く]。
  - 「公開」押下でステータスが `公開済み` に変わる。
  - `failed` 行には [再試行] を出す。

## Env / 初期セットアップ

- 追加env（`.env` とVercel両方）:
  - `ICHIKARA_WP_BASE_URL`
  - `ICHIKARA_WP_USERNAME`
  - `ICHIKARA_WP_APP_PASSWORD`
- 一回だけ ichikarablog コーパス取り込みバッチを実行する（〜1000本の埋め込み生成、
  **一度きりのコスト**。バッチ・レート制御を入れる）。

## エラー処理・エッジケース

- 下調べが空/タイムアウト → モデル知識で執筆を続行し、本文または一覧に「ライブ参照なし」を明示。
- ichikarablog REST/アプリパス失敗 → `composed_drafts` に `status=failed` で保存し、UIから再試行可能。
- アイキャッチ生成失敗 → 画像なしで下書き投稿（既存パイプラインと同挙動）。
- 公開ボタンは冪等（すでにpublishedなら何もしない）。
- **下書き保証**: compose経路は常に status=`draft` で投稿し、明示的な公開ボタンのみが反転する。
  自動公開・SNS投稿は一切行わない。

## テスト / 検証

- テストフレームワークは無し。検証は `npx astro check`（0 errors）＋ dev プレビューでの手動確認。
- 手動E2E: (1) トピック投入→ichikarablogに下書きが立つ、(2) 参照URLが本文に入る、
  (3) 文体がichikarablog寄り、(4) 公開ボタンでWPログインなしに公開反映、
  (5) AIおじさん既存トップ/記事/クロンが無改変で動く。

## 段階（実装計画の想定フェーズ）

1. 基盤: `WordPressTarget` 抽象化 ＋ RAG `corpus` 列/RPC ＋ `composed_drafts` マイグレーション。
2. ichikarablogコーパス取り込みバッチ（一回実行）。
3. 研究サービス（Anthropic Web検索）＋トピック執筆プロンプト/`generateTopicDraft`。
4. `composeDraftForTopic` オーケストレータ ＋ 生成/公開APIエンドポイント。
5. `/admin/compose` UI（フォーム＋一覧＋公開ボタン）。
6. 検証（astro check ＋ 手動E2E）。
