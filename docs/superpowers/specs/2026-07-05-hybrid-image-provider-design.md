# ピラー別ハイブリッド画像生成＋相互フォールバック＋枯渇アラート — 設計

日付: 2026-07-05

## 背景・目的

アイキャッチ画像は現在 `gemini-3.1-flash-image` 単独生成だが品質不満がある。実画像比較の結果、Nano Banana Pro（gemini-3-pro-image）と gpt-image-2（1536×1024・medium）はどちらも日本語テキストを正確に描け、作風が異なる（NB Pro＝軽いバナー調／gpt-image-2＝作り込んだインフォグラフィック調）。また本セッション中に **Gemini 2回・OpenAI 1回のクレジット枯渇**で生成が無言停止した実績があり、(a) プロバイダ冗長化と (b) 枯渇の可視化が必要。

## 方針サマリ

1. **ピラー別ルーティング**: フィジカルAI・生成AIニュース（＋判定不能時の既定）→ Nano Banana Pro／AI駆動開発 → gpt-image-2。
2. **相互フォールバック**: プライマリがエラー（429・5xx・画像データなし）ならもう一方で1回だけ再試行。両方失敗で throw（既存の「画像なしでも記事は公開」安全設計は維持）。
3. **クレジット枯渇アラート**: クォータ系エラーを検知したら `system_alerts` テーブルに記録し、**管理画面ダッシュボードにバナー表示**（Vercelログは誰も見ない、が教訓のため）。

## ルーティング表

| ピラー | プライマリ | フォールバック |
|---|---|---|
| physical-ai | gemini-3-pro-image (Nano Banana Pro) | gpt-image-2 |
| generative-ai-news / 判定不能（既定） | gemini-3-pro-image | gpt-image-2 |
| ai-driven-development | gpt-image-2（size 1536x1024, quality medium） | gemini-3-pro-image |

コスト目安（5枚/日）: NB Pro $0.134×3〜4枚 + gpt-image-2 $0.041×1〜2枚 ≈ **月$15〜20**。
速度: NB Pro 約21秒／gpt-image-2 約54秒。フォールバック発動時は最悪約80秒/枚。

## アーキテクチャ

### 1. 画像プロバイダ・モジュール — `src/services/images/provider.ts`（新規）

`generateFeaturedImageBuffer(prompt: string, pillar?: string): Promise<{ buffer: Buffer; provider: 'gemini' | 'openai'; model: string }>`

- ルーティング: `pillar === 'ai-driven-development'` → primary=openai、それ以外 → primary=gemini。
- 内部実装:
  - `generateWithGemini(prompt)` — `@google/genai` の `generateContent`（model `gemini-3-pro-image`、`responseModalities:['IMAGE','TEXT']`）。inlineData 無しは throw。既存 `generateAndAttachFeaturedImage` の生成部を移設。
  - `generateWithOpenAI(prompt)` — 既存依存 `openai` の `images.generate({ model:'gpt-image-2', size:'1536x1024', quality:'medium' })`。`b64_json` 無しは throw。PNGで返る（現行のWPアップロードは `image/png` 前提のため変更不要）。
- フォールバック: primary を try → catch で warn ログ＋secondary を try。両方失敗なら最後のエラーを throw。
- 使用プロバイダ・モデルを毎回 `logger.info` に記録。
- **クォータ検知**: 各プロバイダのエラー捕捉時、メッセージに `429` / `RESOURCE_EXHAUSTED` / `insufficient_quota` / `credits are depleted` を含む場合は `recordQuotaAlert(provider, message)`（下記）を呼ぶ（fire-and-forget、失敗しても生成フローに影響させない）。

### 2. 枯渇アラート — マイグレーション + 記録関数 + ダッシュボード表示

**Migration `supabase/migrations/003_system_alerts.sql`（新規）**:
```sql
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

**記録関数**（`provider.ts` 内 or `src/services/images/alerts.ts`）: `recordQuotaAlert(source, message)` — **スパム防止**として、同一 `source` のアラートが直近6時間内に存在すれば insert しない。

**ダッシュボード表示**（`src/pages/admin/index.astro` に追記）: 直近7日の `system_alerts` を取得し、1件以上あれば上部に赤系の警告バナー: 「⚠️ 画像生成のクレジット枯渇を検知: {source}（{最新時刻}）。AI Studio / OpenAI Billing で残高を確認してください。」複数ソースなら並記。取得失敗時はバナー非表示（ダッシュボードを壊さない）。

### 3. 呼び出し側の変更

- `src/services/wordpress/client.ts` — `generateAndAttachFeaturedImage(postId, title, summary, slug, pillar?)` に第5引数を追加。プロンプト構築（現行文言のまま・両モデル共通）→ `generateFeaturedImageBuffer(prompt, pillar)` → 既存のWPメディアアップロード＋添付。Gemini 直呼びコードと `IMAGE_MODEL` 定数は provider.ts へ移設。
- `src/services/drafts/generate.ts` — 判定済み `pillarCategories[0]?.slug` を渡す（1行）。
- `src/services/images/backfill.ts` — `detectPillarCategories([post.title, post.summary])` で判定し、先頭スラッグを渡す。**`BACKFILL_LIMIT` を 10 → 5 に戻す**。根拠: 通常ケースは混在で 5×約20〜55秒 ≈ 250秒以内に収まり300秒制限内。全件フォールバック（プロバイダ全面障害）時は 5×約80秒 ≈ 400秒で超過しうるが、タイムアウトしても添付済み分は残り、再クリックで継続できる既存の冪等設計で受容する（稀なエッジケース）。

## エラー処理・安全性

- 両プロバイダ失敗時のみ throw → 呼び出し元の既存 try/catch により「記事はプレースホルダで公開」（現行と同じ・後でバックフィル可能）。
- アラート記録の失敗は握りつぶす（画像生成を阻害しない）。
- cron の繰越公開が1回で複数本×全部フォールバックの最悪ケースは理論上300秒超だが、公開済み分は残り、次の毎時実行が続きを拾うため受容（spec に明記）。

## 検証

テスト基盤なし（`astro check` のみ）。
- `astro check` 0 errors。
- ローカル一発スクリプトで `generateFeaturedImageBuffer` を pillar 3種で呼び、ルーティングとフォールバック（無効キーで強制失敗→他方成功）を確認（課金は数枚分）。
- Migration 003 を本番 Supabase に適用（ユーザー操作）→ デプロイ → 実運用で確認。
- ダッシュボードバナーは dev で `system_alerts` に手動行を入れて表示確認。

## スコープ外（YAGNI）

- リトライ回数の設定化、3プロバイダ目、モデル別カスタムプロンプト、アラートの既読/解決フロー、画像以外（採点・執筆）のクォータアラート統合（将来拡張は可能な構造にはなる）。

## 既知の前提・留意

- `openai` パッケージは導入済み（追加依存なし）。`OPENAI_API_KEY` も設定済み。
- gpt-image-2 の billing はトークン動的計算で公称 $0.041/枚（1536×1024 medium）は目安。
- デプロイ順: **Migration 003 適用 → コードデプロイ**（アラートinsertが先に走ると失敗するが、握りつぶす設計なので順序が逆でも実害はログのみ）。
