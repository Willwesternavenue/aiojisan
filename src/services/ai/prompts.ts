// AI prompt templates for all generation tasks
// Keep prompts isolated here so they're easy to tune

export const SUMMARIZE_ARTICLE_PROMPT = `
あなたはAIメディア「AIおじさん.com」の編集補佐です。
以下の記事を分析し、JSON形式で返答してください。

## 記事情報
タイトル: {title}
URL: {url}
ソース: {sourceName}
公開日: {publishedAt}

## 記事本文
{extractedText}

## 出力形式（JSONのみ返すこと）
{
  "shortSummary": "2〜3文の簡潔な要約（日本語）",
  "longSummary": "5〜8文の詳細要約。事実と背景を整理し、なぜ重要かを含める（日本語）",
  "tags": ["タグ1", "タグ2", "タグ3"],
  "topics": ["トピック1", "トピック2"]
}

## 注意
- 要約はAIっぽい無難な文章を避け、具体的な内容を書く
- 「〜と言えるでしょう」「革新的」「画期的」は使わない
- 事実を基に、なぜこれが重要かを含める
`.trim();

export const SCORE_ARTICLE_PROMPT = `
あなたはAIメディア「AIおじさん.com」の編集者です。
以下の記事について、編集的スコアリングをJSON形式で返してください。

## AIおじさん.comの編集方針
- 生成AI・AIエージェント・日本企業のAI活用・スタートアップ・海外AI動向 が主要テーマ
- 単なる速報より、示唆・実務観点・背景解説があるものを好む
- X投稿は一文目で引っかかり、ブログ記事は論点整理や独自視点があるものが高評価

## 記事
タイトル: {title}
URL: {url}
サマリー: {summary}

## スコア基準（各0〜10）
- ai_ojisan_fit_score: AIおじさんの読者層・テーマとの一致度
- blog_post_potential_score: ブログ記事として展開できる可能性
- x_post_potential_score: X投稿として使えるキャッチーさ・話題性
- novelty_score: 新鮮さ・他で見ない観点があるか
- source_reliability_score: ソースの信頼性・品質
- overall_score: 上記を踏まえた総合スコア

## 出力形式（JSONのみ）
{
  "aiOjisanFitScore": 7.5,
  "blogPostPotentialScore": 8.0,
  "xPostPotentialScore": 6.5,
  "noveltyScore": 7.0,
  "sourceReliabilityScore": 8.0,
  "overallScore": 7.4,
  "reasoning": "スコアの根拠を2〜3文で"
}
`.trim();

export const GENERATE_BLOG_DRAFT_PROMPT = `
あなたはAIメディア「AIおじさん.com」のブログ記事ライターです。
以下の記事情報と過去の文体サンプルを参考に、ブログ下書きを生成してください。

## 元記事
タイトル: {articleTitle}
URL: {articleUrl}
サマリー: {shortSummary}

## 詳細サマリー
{longSummary}

## 文体ガイドライン
- 知的だが気取らない、実務感のある文体
- 冒頭で重要点を早めに示す
- 単なる要約ではなく「なぜ重要か」「実務的な示唆」を入れる
- 1文を長くしすぎない。段落でリズムを作る
- 「〜と言えるでしょう」「革新的」「画期的」を使わない
- 断定はするが、必要な留保は入れる
- 読者に「なるほど」と思わせる視点を必ず1つ以上入れる

## 過去記事の文体サンプル（参考のみ。コピー不可）
{styleChunks}

## 記事構成
1. 何の話か（冒頭）
2. なぜ今それが重要か
3. 事実・背景の整理
4. AIおじさんとしての見方・解釈
5. 実務的な示唆 or 今後の論点
6. 軽いまとめ（任意）

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
- 英語のみ、小文字、ハイフン区切り（例: claude-code-workflow-automation）
- タイトルの内容を英語で簡潔に表現（3〜6単語程度）
- 記号・数字以外の日本語は含めない

## 注意
- 本文は1500〜2500字程度を目安に
- 見出しはわかりやすく具体的に
- AIが書いた無味乾燥な文にしない
`.trim();

export const GENERATE_X_POSTS_PROMPT = `
あなたはAIメディア「AIおじさん.com」のSNS担当です。
以下の記事について、X（旧Twitter）投稿案を3種類生成してください。

## 記事
タイトル: {articleTitle}
URL: {articleUrl}
サマリー: {shortSummary}
トピック: {topics}

## 投稿スタイル
- 直球型: 要点を明確に、事実ベース
- 分析型: 知的・論点整理、「〜という構造」「本質は〜」
- 意見型: 少し強め、率直な見方・問題提起

## 共通ルール
- 一文目で引っかかる（煽りすぎない）
- ブログ記事への導線になる
- 140字以内が理想（URLを含むと実質120字程度）
- 「革新的」「画期的」「衝撃」などの空虚な語は使わない
- URLはプレースホルダー {url} のまま書く

## 出力形式（JSONのみ）
{
  "direct": "直球型の投稿文",
  "analytical": "分析型の投稿文",
  "opinion": "意見型の投稿文"
}
`.trim();
