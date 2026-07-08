# 毎日最低1本の公開保証（条件付きフロア）— 設計

日付: 2026-07-09

## 背景・目的

自動公開のしきい値は総合スコア8.5だが、実データでは**8.5以上は1日0〜2件**（停止前の6月中旬も復旧後も同じ分布）で、公開が0本の日が普通に発生する（直近では7/7・7/8が連続0本）。スコアは採点プロンプトの減点キャップにより8.0〜8.4に張り付きやすい。ユーザー要件は「**毎日最低1本**」。しきい値を静的に下げると質の平均が下がり、かつ涸れた日のゼロは解消しない。そこで**条件付きフロア**を導入する：通常は8.5のまま、公開が24時間途絶えたときだけ、最良の1本（下限8.0）を自動公開する。

## 方針サマリ

- 通常の自動公開（8.5、例外枠9.2、日次上限5・フィジカルAI2）は**一切変更しない**。
- **フロア発動条件**: `generated_drafts` に `status='published'` の行が**直近24時間に1件も無い**とき。
- **候補選定**: 直近48時間に採点された記事のうち、`overall_score >= 8.0` かつ未ドラフト（`article_actions` に `generate_blog_draft` 無し・`generated_drafts` 無し）のもの。`overall_score` 降順 → `blog_post_potential_score` 降順で**1本だけ**。
- 公開は既存 `publishArticle`（通常経路：画像・X投稿・カテゴリすべて通常どおり）。バックデートしない。
- ローリング24hなので自己ペーシング：フロアで1本出せば次の24hはフロア不発。通常の8.5公開があってもリセットされる。結果「最低ほぼ1本/日・フロアは最大1本/日」。

## 変更箇所（`src/pages/api/cron/process-articles.ts` のみ）

### 新関数 `publishDailyFloorCandidate(db, publishStats)`

1. `generated_drafts` から `status='published'` の最新 `created_at` を取得。**24時間以内なら何もしない**（`{ published: 0 }` を返す）。
2. 候補クエリ: `articles` を `article_ai_insights!inner(...)` 結合、`article_ai_insights.generated_at >= now-48h`、クライアント側で `overall_score >= 8.0`・未ドラフトをフィルタ（既存carryoverと同じ Array正規化・`generated_drafts`/`article_actions` 除外パターンを踏襲）、スコア降順ソート、先頭1本。
3. 候補なしなら何もしない（8.0未満しか無い日は諦める＝品質下限は守る）。
4. `publishArticle(article.id, scores, pillarCategories, publishStats, 'daily-floor')` で公開し、`logger.info('Daily floor publish', {...score...})`。

### handler への組み込み

既存の `carryover` 実行と新規候補処理の**後**（handler末尾near）に呼ぶ。ただし実装簡素化のため、`publishStats` はhandler冒頭で取得済みのものを渡し、**その回の通常公開が1本でもあればフロアは自然に不発**（`publishStats.total` 更新済み、または最新published行が24h内になる）— 発動条件は関数内の「最新published行が24h内か」の再クエリで判定するため、同一実行内の公開も正しく検知される（`publishArticle` 成功＝`generated_drafts` insert 済み）。

## エラー処理・安全性

- フロア公開の失敗は warn ログのみ（cron全体は成功で返す。次の毎時実行が再試行になる）。
- 候補の未ドラフト条件は既存と同じ（`generateDraftForArticle` の冪等ガードも二重の安全網）。
- 総枠 `DAILY_AUTO_PUBLISH_TARGET` との関係：フロアは「0本のとき1本」なので上限に抵触しない。判定バイパスは意図どおり（8.5未満を1本だけ通す）。

## 検証

- `npx astro check` 0 errors。
- 実運用確認：現在まさに24h以上公開ゼロ＋直近48hに8.4等の候補がある状態なので、**デプロイ後の次の毎時cronでフロアが1本公開するはず**。Vercelログの `Daily floor publish` と、公開記事のスコア（8.0〜8.4帯）で答え合わせ。

## スコープ外（YAGNI）

- しきい値自体の変更、フロア本数の設定化、時間帯ゲート、管理画面での可視化。
