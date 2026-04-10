# AIおじさん Blog System

生成AI・テクノロジー情報を自動収集・分析し、ブログ記事の下書きを生成するエディトリアルワークフローシステム。

---

## システム概要

```
RSS/HTML ソース
      ↓
  記事収集（Ingestion）
      ↓
  AI 分析（要約・スコアリング）
      ↓
  スコア 7.9 以上 → 自動ドラフト生成
      ↓
  WordPress に下書き送信
      ↓
  管理者がレビュー・加筆・公開
      ↓
  公開サイト（AIおじさん.com）に表示
```

---

## 技術スタック

| レイヤー | 技術 |
|---|---|
| フロントエンド / SSR | Astro 6 + Tailwind CSS v4 |
| デプロイ | Vercel（SSR + Cron Jobs） |
| データベース | Supabase（PostgreSQL + pgvector） |
| AI | OpenAI gpt-4o-mini（要約・スコアリング）/ gpt-4o（ドラフト生成） |
| CMS | WordPress（さくらのレンタルサーバー） |
| スタイル参照（RAG） | pgvector による過去記事の埋め込み検索 |

---

## 機能一覧

### 1. ニュース収集（Ingestion）

- RSS フィードと HTML ページの両方に対応
- 日本語エンコーディング自動検出（Shift-JIS / EUC-JP / UTF-8）
- URL・コンテンツハッシュによる重複排除
- 登録済みソースは現在 7 件：

| ソース | タイプ | 優先度 |
|---|---|---|
| Gigazine AI | RSS | 8 |
| ITmedia AI+ | RSS | 8 |
| The Decoder | RSS | 8 |
| Zenn AI | RSS | 7 |
| Qiita AI | RSS | 7 |
| TechCrunch AI | RSS | 7 |
| AI News Dev | HTML | 5 |

### 2. AI 分析

収集した記事を OpenAI で処理：

- **短サマリー**（3文程度、日本語）
- **詳細サマリー**（400字程度、日本語）
- **スコアリング**（各項目 1〜10 点）
  - 総合スコア
  - AIおじさん適性
  - ブログ適性
  - X（Twitter）投稿適性
  - 新鮮度
  - ソース信頼性
- タグ・トピック抽出

### 3. 自動ドラフト生成

- **スコア 7.9 以上** の記事は自動で下書きを生成
- RAG（過去ブログ記事の文体参照）により一貫した文体で執筆
- WordPress に下書きとして自動送信
- タイトル案を複数生成（最上位案を採用）

### 4. 管理画面（/admin）

| ページ | 機能 |
|---|---|
| ダッシュボード | 統計・最近の実行履歴 |
| ソース管理 | RSS/HTML ソースの追加・編集・手動実行 |
| ニュースフィード | 収集済み記事一覧（スコア順・ソース順・新着順） |
| 記事詳細 | AI サマリー・スコア表示、ドラフト生成ボタン |
| 下書き履歴 | 生成済みドラフト一覧、WordPress リンク |

### 5. 公開サイト（/）

- WordPress の公開済み記事を取得してトップページに表示
- 「注目の記事」「最新記事」セクション

---

## 自動実行スケジュール（Vercel Cron）

| ジョブ | スケジュール | 内容 |
|---|---|---|
| fetch-sources | 15分ごと | 全ソースから記事収集 |
| process-articles | 1時間ごと | 未処理記事を AI 分析（20件/回）、7.9+ は自動ドラフト化 |
| refresh-priority-sources | 6時・18時 | 優先ソースの再取得 |

---

## セットアップ

### 必要環境

- Node.js 18+
- Supabase プロジェクト（pgvector 有効）
- WordPress サイト（Application Password 設定済み）
- OpenAI API キー
- Vercel アカウント

### 環境変数

`.env.example` を参照。以下の変数が必要：

```
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
OPENAI_API_KEY
WORDPRESS_BASE_URL
WORDPRESS_USERNAME
WORDPRESS_APP_PASSWORD
ADMIN_SECRET        # 管理画面の保護用（16文字以上）
CRON_SECRET         # Cron 認証用（16文字以上）
```

### ローカル起動

```bash
npm install
npm run dev
```

管理画面: http://localhost:4321/admin

### DB マイグレーション

Supabase Dashboard の SQL Editor で実行：

```
supabase/migrations/001_initial_schema.sql
```

### Vercel デプロイ

1. GitHub リポジトリを Vercel に接続
2. 環境変数を Vercel に設定（`.env` の内容をコピー）
3. `git push` で自動デプロイ

---

## ディレクトリ構成

```
src/
├── layouts/          # AdminLayout, PublicLayout
├── lib/
│   ├── auth.ts       # 認証・Cron 認証ヘルパー
│   ├── env.ts        # 環境変数バリデーション（Zod）
│   └── supabase/     # DB クライアント・クエリ
├── middleware.ts     # 管理画面の認証ミドルウェア
├── pages/
│   ├── admin/        # 管理画面ページ
│   ├── api/
│   │   ├── admin/    # 管理 API エンドポイント
│   │   └── cron/     # Cron ジョブエンドポイント
│   └── index.astro   # 公開トップページ
└── services/
    ├── ai/           # OpenAI 連携（要約・スコアリング・ドラフト生成）
    ├── drafts/       # ドラフト生成共通ロジック
    ├── ingestion/    # 記事収集パイプライン
    ├── rag/          # 文体参照（pgvector）
    └── wordpress/    # WordPress REST API クライアント
```

---

## 注意事項

- `.env` はリポジトリに含めない（`.gitignore` 済み）
- 管理画面はログイン不要（開発中）→ 本番では Supabase Auth でユーザー作成が必要
- Cron エンドポイントは `Authorization: Bearer {CRON_SECRET}` で保護済み
