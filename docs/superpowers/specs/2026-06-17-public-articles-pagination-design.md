# 公開記事一覧のサーバー側ページング — 設計

日付: 2026-06-17

## 背景・目的

公開記事一覧 `src/pages/articles/index.astro` は WordPress から `per_page=50` で1回だけ取得し、ページングが無い。そのため **51件目以降の記事が一覧UIから辿れず**、クローラも一覧から全記事へ到達できない（SEO上の損失）。さらにカテゴリ絞り込みは「取得済み50件をクライアント側でフィルタ」なので、古い記事はカテゴリで絞っても出ない。本機能で**全記事をページをまたいで辿れる**ようにし、カテゴリ絞り込みも WordPress 側クエリに変える。

公開記事総数は現状 218 件（増加中）。

## 方針サマリ

- URL: `/articles?page=N`、カテゴリ選択時は `/articles?category=<slug>&page=N`。`page` 既定 1、1ページ 50 件。
- ページ送りは実際の `<a href>` リンク（JS不要）＝クローラが全ページを巡回でき、全記事がインデックス対象になる。
- カテゴリ絞り込みを **WordPress 側クエリ**（`categories=<id>`）に変更。各カテゴリも全記事ページングできる。
- ページ総数は WordPress レスポンスヘッダ `X-WP-TotalPages` / 総件数 `X-WP-Total` から取得。
- カテゴリピルの件数は WordPress カテゴリの `count`（全件ベース）を使う。

## アーキテクチャ（`src/pages/articles/index.astro` の改修）

### 1. 投稿取得を「ページ取得」に変更

`fetchPostsPage(page: number, categoryId?: number): Promise<{ posts: WpPost[]; total: number; totalPages: number }>`
- リクエスト: `${base}/wp-json/wp/v2/posts` に `status=publish&per_page=50&page=${page}&orderby=date&order=desc&_embed=wp:featuredmedia&_fields=id,slug,title,excerpt,date,link,featured_media,categories,_links`（`categoryId` があれば `&categories=${categoryId}`）。
- `total = Number(res.headers.get('X-WP-Total') ?? 0)`、`totalPages = Number(res.headers.get('X-WP-TotalPages') ?? 1)`。
- `res.ok` でなければ（範囲超過の 400 等）`{ posts: [], total: 0, totalPages: 1 }` を返す。

### 2. フロントマター

- `const PAGE_SIZE = 50;`
- `page` を `?page` から取得（数値・1以上に正規化、既定 1）。
- `selectedSlug` を `?category` から取得。
- `allCategories = await fetchCategories()`（既存）→ `categoryMap`（id→category）。`selectedSlug` から WordPress カテゴリ id を解決（`allCategories.find(c => c.slug === selectedSlug)?.id`）。
- `const { posts: rawPosts, total, totalPages } = await fetchPostsPage(page, selectedCategoryId)`。
- 記事整形（既存の `stripHtml` / `getEditorialCategory` ロジックを流用）。
- ページネーション補助: `hasPrev = page > 1`、`hasNext = page < totalPages`、`prevHref` / `nextHref`（`?page=` と、選択中なら `&category=<slug>` を維持）。

### 3. カテゴリピルの件数

- 各 `EDITORIAL_CATEGORIES` のピル件数 = 対応する WordPress カテゴリ（`slug` 一致）の `count`。`count > 0` のものだけ表示（既存の絞り込みは踏襲）。
- 「すべて」ピルの件数 = 無フィルタ時の `X-WP-Total`。カテゴリ選択中もこの総数を見せたい場合は、`fetchPostsPage(1)`（無フィルタ）の `total` を別途取得して使う。

### 4. UI（既存マークアップに追加）

- 見出し横の「N 件」は、現在のビュー（フィルタ適用後）の `total` を表示。
- 記事リストは現状どおりレンダリング（取得した `rawPosts` をそのまま）。
- リスト上部と下部に**前/次リンク**（`hasPrev` / `hasNext` で活性・非活性を出し分け）＋「{page} / {totalPages} ページ」。リンクは `<a href>`。

## データフロー

`/articles?category=&page=` リクエスト → カテゴリ一覧取得 + 該当ページ取得（ヘッダから総ページ数）→ 整形 → リスト＋前/次リンク描画。各ページは独立した URL でクロール可能。

## SEO 配慮

- ページ送りは実リンク（クロール可能）。
- **各ページは自己参照 canonical にする**。`PublicLayout` の既存 canonical は `siteUrl + Astro.url.pathname`（クエリ文字列を含まない）ため、そのままだと `/articles?page=2` が `/articles`（1ページ目）を指してしまう。これを避けるため、`articles/index.astro` から `PublicLayout` に明示的な `canonical` を渡す:
  - `const canonicalPath = '/articles' + ([selectedSlug ? \`category=${selectedSlug}\` : '', page > 1 ? \`page=${page}\` : ''].filter(Boolean).join('&') ? '?' + [...].join('&') : '')`
  - すなわち page>1 や category 選択時はクエリ込みの URL を canonical にし、1ページ目・無フィルタ時は `/articles` にする。
- 範囲外 `page` 指定時は、`totalPages` を超える場合でも前ページへ戻れる UI を保つ（実害が出ないこと優先）。

## テスト/検証

テスト基盤は無い（`astro check` のみ）。`astro check` ＋ dev サーバで以下を目視:
- `/articles` が 1 ページ目 50 件＋「次」リンク表示。
- `/articles?page=2` 等で次の 50 件、件数・ページ番号が正しい。
- `/articles?category=<slug>` でそのカテゴリの記事がページング表示される（古い記事も到達できる）。

## スコープ外（YAGNI）

- 無限スクロール、サイト内検索、1ページ件数の変更UI、`rel="next/prev"` メタ（実リンクで足りるため）。

## 既知の前提・留意

- カテゴリ絞り込みを WordPress 側に移すため、ある記事が複数のピラーカテゴリに属する場合、表示バッジ（`getEditorialCategory` が選ぶ代表カテゴリ）と、フィルタ対象カテゴリが一致しないことがある。フィルタは「そのカテゴリに属する記事」を正しく返すので実害は小さい。
