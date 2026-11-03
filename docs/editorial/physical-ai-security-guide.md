# フィジカルAIセキュリティのまとめ記事：実装メモと残タスク

対象ページ：`/guides/physical-ai-security`（実装は `src/pages/guides/[slug].astro`、
データは `src/services/editorial/guides.ts`）

## 仕組み

- 見出しと本文、見出しごとの関連記事スラッグを `guides.ts` に持っています。
  記事タイトル・日付は WordPress から実行時に取得するので、WP側でタイトルを直しても追従します。
- WordPress に存在しないスラッグは描画時に黙って除外されます（リンク切れを作らない）。
- 「最新動向」は `freshness.domain`（ロボット、工場など）と `freshness.aspect`
  （セキュリティ、安全など）の**両方**をタイトルに含む新しい記事を自動で拾うため、
  月次の手作業更新は不要です。条件を満たす記事がないあいだ、この節は表示されません。
- 記事側（`/articles/[slug]`）には、そのスラッグを参照しているガイドへの逆リンクが
  自動で出ます。**WordPress の本文を20本編集する必要はありません。**
- ガイドに記事を足すのは `guides.ts` の該当セクションに1行追加するだけです。

## 残タスク

### 公開前に確認が必要

- [ ] 狙う検索語の検索ボリューム（キーワードプランナー等で確認）。
      現在の設定：主「フィジカルAI セキュリティ」「フィジカルAI 安全性」、
      副「ロボット LLM リスク」「プロンプトインジェクション ロボット」「工場 AI セキュリティ」
      「ヒューマノイド 安全基準」（`guides.ts` の `keywords`）。
- [ ] 「規格・フレームワークの現状」の節は、規格名と版を意図的に書いていません。
      具体名を入れる場合は導入時点の一次情報で確認してから追記すること。
- [ ] 公開後、Search Console で `/guides/physical-ai-security` の表示回数・掲載順位を確認。

### 重複記事の統合候補

まとめ記事からは代表記事1本だけにリンクし、統合は別作業にしています。

| 残す | 統合を検討 |
|---|---|
| `gartner-hype-cycle-2026-physical-ai-peak` | `gartner-2026-hype-cycle-physical-ai-peak` |
| `ai-agent-api-key-security-credential-management` | `ai-generated-code-api-key-leak` |
| `physical-ai-safety-deterministic-supervisor` | `physical-ai-robotics-safety-design-shift` |

統合する場合は WordPress 側で本文をまとめ、旧スラッグから新スラッグへ301リダイレクトを設定し、
`guides.ts` のスラッグを更新します。

### 新しく書く記事（優先順）

どれも実務ガイド型。GA4のデータでは、この形式の記事（医療AIコンプライアンス21PV、
APIキー管理12PV）がニュース解説型（1〜2PV）より読まれています。

1. 工場ロボットにLLMを載せるときの脅威モデル（`#threats` の本体）
2. プロンプトインジェクションでロボットが誤動作するパターンと対策（`#threat-prompt-injection`）
3. フィジカルAI導入前の安全チェックリスト（`#checklist` を単体記事に展開）
4. 機能安全の規格とAI：何が決まっていて何が未整備か（`#standards`）

書いたら `guides.ts` の該当セクションの `articles` に追加する。

### カバーできていない節

- `#threat-sensors`（センサー・学習データへの改ざん）に該当する既存記事がありません。
  新規記事1本目でまとめて扱うか、単体記事を足すか。
