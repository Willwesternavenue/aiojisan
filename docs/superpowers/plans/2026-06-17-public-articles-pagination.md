# Public Articles Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public `/articles` list paginate server-side (50/page, crawlable prev/next links) so every article is reachable, and move category filtering to WordPress-side queries so old articles are reachable per category.

**Architecture:** Rewrite `src/pages/articles/index.astro`. Replace the single `per_page=50` fetch with `fetchPostsPage(page, categoryId)` that reads `X-WP-Total`/`X-WP-TotalPages` headers. Resolve the selected editorial category to its WordPress category id and pass it to the query. Render real `<a href>` prev/next links and a self-referencing canonical that includes `category`/`page`.

**Tech Stack:** Astro 6 (SSR), WordPress REST. No test framework — verify with `npx astro check` plus a manual dev-server check.

---

### Task 1: Rewrite the public articles page with pagination

**Files:**
- Modify (full rewrite): `src/pages/articles/index.astro`

**Context the implementer needs:**
- `PublicLayout` accepts a `canonical?: string` prop; when provided it uses it verbatim, otherwise it falls back to `siteUrl + Astro.url.pathname` (which drops query strings). We pass an explicit canonical so paginated pages self-canonicalize.
- The editorial pillars (`generative-ai-news`, `ai-driven-development`, `physical-ai`) exist as real WordPress categories whose `slug` matches the editorial slug, so filtering by the WP category id matching the selected slug is correct.
- WordPress REST returns `X-WP-Total` (total items) and `X-WP-TotalPages` headers on `/posts`. A request for a page past the end returns HTTP 400 — handle by returning empty.
- The global CSS classes `category-pill` / `category-pill-active` already exist (used by the current page).

- [ ] **Step 1: Replace the entire contents of `src/pages/articles/index.astro` with:**

```astro
---
import PublicLayout from '@/layouts/PublicLayout.astro';

const EDITORIAL_CATEGORIES = [
  {
    slug: 'generative-ai-news',
    label: '生成AIニュース',
    description: 'モデル、プロダクト、研究、企業導入、政策などAI全般の動き',
  },
  {
    slug: 'ai-driven-development',
    label: 'AI駆動開発',
    description: 'コーディングエージェント、開発プロセス、DevOps、PM/QA',
  },
  {
    slug: 'physical-ai',
    label: 'フィジカルAI',
    description: 'ロボット、ヒューマノイド、自動運転、製造・物流現場のAI',
  },
] as const;

type WpCategory = {
  id: number;
  name: string;
  slug: string;
  count: number;
};

type WpPost = {
  id: number;
  slug: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  date: string;
  link: string;
  categories: number[];
  _embedded?: {
    'wp:featuredmedia'?: { source_url: string }[];
  };
};

const base = import.meta.env.WORDPRESS_BASE_URL?.replace(/\/$/, '') ?? '';
const PAGE_SIZE = 50;

async function fetchCategories(): Promise<WpCategory[]> {
  try {
    const res = await fetch(`${base}/wp-json/wp/v2/categories?per_page=100&hide_empty=true&_fields=id,name,slug,count`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

async function fetchPostsPage(
  page: number,
  categoryId?: number,
): Promise<{ posts: WpPost[]; total: number; totalPages: number }> {
  try {
    const params = new URLSearchParams({
      per_page: String(PAGE_SIZE),
      page: String(page),
      status: 'publish',
      _embed: 'wp:featuredmedia',
      orderby: 'date',
      order: 'desc',
      _fields: 'id,slug,title,excerpt,date,link,featured_media,categories,_links',
    });
    if (categoryId) params.set('categories', String(categoryId));
    const res = await fetch(`${base}/wp-json/wp/v2/posts?${params}`);
    if (!res.ok) return { posts: [], total: 0, totalPages: 1 };
    const posts = (await res.json()) as WpPost[];
    const total = Number(res.headers.get('X-WP-Total') ?? '0');
    const totalPages = Number(res.headers.get('X-WP-TotalPages') ?? '1');
    return { posts, total, totalPages };
  } catch {
    return { posts: [], total: 0, totalPages: 1 };
  }
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

const selectedSlug = Astro.url.searchParams.get('category') ?? '';
const pageParam = Number(Astro.url.searchParams.get('page') ?? '1');
const page = Number.isFinite(pageParam) && pageParam >= 1 ? Math.floor(pageParam) : 1;

const allCategories = await fetchCategories();
const categoryMap = new Map(allCategories.map(c => [c.id, c]));
const selectedCategoryId = selectedSlug
  ? allCategories.find(c => c.slug === selectedSlug)?.id
  : undefined;

const { posts: rawPosts, total, totalPages } = await fetchPostsPage(page, selectedCategoryId);
// When a category is selected, also fetch the unfiltered total for the "すべて" pill.
const allTotal = selectedCategoryId ? (await fetchPostsPage(1)).total : total;

function getEditorialCategory(categoryIds: number[]) {
  const categorySlugs = categoryIds
    .map(id => categoryMap.get(id)?.slug)
    .filter(Boolean);

  return EDITORIAL_CATEGORIES.find(category => categorySlugs.includes(category.slug))
    ?? EDITORIAL_CATEGORIES[0];
}

const articles = rawPosts.map(p => {
  const category = getEditorialCategory(p.categories);
  return {
    slug: p.slug,
    title: stripHtml(p.title.rendered),
    excerpt: stripHtml(p.excerpt.rendered),
    publishedAt: p.date,
    link: p.link,
    thumbnail: p._embedded?.['wp:featuredmedia']?.[0]?.source_url ?? null,
    categoryName: category.label,
    categorySlug: category.slug,
  };
});

// カテゴリピル: 3本柱の全件カウント(WPカテゴリのcount)を固定順で表示
const categories = EDITORIAL_CATEGORIES
  .map(category => ({
    ...category,
    count: allCategories.find(c => c.slug === category.slug)?.count ?? 0,
  }))
  .filter(category => category.count > 0);

const selectedCategory = categories.find(c => c.slug === selectedSlug);

// ページネーション用URL（categoryを維持、pageは2以上のときだけ付与）
function hrefFor(p: number): string {
  const params = new URLSearchParams();
  if (selectedSlug) params.set('category', selectedSlug);
  if (p > 1) params.set('page', String(p));
  const s = params.toString();
  return '/articles' + (s ? `?${s}` : '');
}

const hasPrev = page > 1;
const hasNext = page < totalPages;
const prevHref = hrefFor(page - 1);
const nextHref = hrefFor(page + 1);
const canonical = `https://www.aiojisan.com${hrefFor(page)}`;
---

<PublicLayout
  title={selectedCategory ? `${selectedCategory.label} の記事` : '記事一覧'}
  description="AIおじさんのひとりごと — 記事一覧"
  canonical={canonical}
>
  <div class="max-w-admin mx-auto px-6 py-12">
    <div class="flex items-baseline justify-between mb-8">
      <h1 class="text-2xl font-semibold text-text-primary">
        {selectedCategory ? selectedCategory.label : '記事一覧'}
      </h1>
      <p class="text-sm text-text-muted">{total} 件</p>
    </div>

    <!-- カテゴリフィルター -->
    {categories.length > 0 && (
      <div class="flex flex-wrap gap-2 mb-10">
        <a
          href="/articles"
          class={`category-pill ${!selectedSlug ? 'category-pill-active' : ''}`}
        >
          すべて
          <span class="ml-1 text-xs opacity-60">({allTotal})</span>
        </a>
        {categories.map(cat => (
          <a
            href={`/articles?category=${encodeURIComponent(cat.slug)}`}
            class={`category-pill ${selectedSlug === cat.slug ? 'category-pill-active' : ''}`}
            title={cat.description}
          >
            {cat.label}
            <span class="ml-1 text-xs opacity-60">({cat.count})</span>
          </a>
        ))}
      </div>
    )}

    <!-- 記事リスト -->
    {articles.length === 0 ? (
      <div class="py-20 text-center">
        <p class="text-text-muted">記事を準備中です</p>
      </div>
    ) : (
      <div class="space-y-0 divide-y divide-border">
        {articles.map(article => (
          <a
            href={`/articles/${article.slug}`}
            class="group flex items-start gap-4 py-5 hover:bg-[#F5F5F3] -mx-3 px-3 rounded transition-colors"
          >
            {article.thumbnail && (
              <div class="w-24 h-16 flex-shrink-0 rounded overflow-hidden bg-[#F0F0EE]">
                <img src={article.thumbnail} alt={article.title} class="w-full h-full object-cover" loading="lazy" />
              </div>
            )}
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1.5">
                <span class="text-xs text-accent font-medium">{article.categoryName}</span>
                <span class="text-xs text-text-muted">
                  {new Date(article.publishedAt).toLocaleDateString('ja-JP')}
                </span>
              </div>
              <h2 class="text-base font-semibold text-text-primary mb-1.5 leading-snug group-hover:text-accent transition-colors">
                {article.title}
              </h2>
              <p class="text-sm text-text-secondary leading-relaxed line-clamp-2">
                {article.excerpt}
              </p>
            </div>
          </a>
        ))}
      </div>
    )}

    <!-- ページネーション -->
    {totalPages > 1 && (
      <nav class="mt-10 flex items-center justify-center gap-4 text-sm">
        {hasPrev ? (
          <a href={prevHref} class="border border-border rounded px-4 py-2 text-accent hover:bg-[#F5F5F3] transition-colors">← 前へ</a>
        ) : (
          <span class="border border-border rounded px-4 py-2 text-text-muted opacity-40">← 前へ</span>
        )}
        <span class="text-text-muted">{page} / {totalPages}</span>
        {hasNext ? (
          <a href={nextHref} class="border border-border rounded px-4 py-2 text-accent hover:bg-[#F5F5F3] transition-colors">次へ →</a>
        ) : (
          <span class="border border-border rounded px-4 py-2 text-text-muted opacity-40">次へ →</span>
        )}
      </nav>
    )}
  </div>
</PublicLayout>
```

- [ ] **Step 2: Type-check**

Run: `npx astro check`
Expected: 0 errors. (The page no longer references the removed `filtered` variable; `total`, `totalPages`, `allTotal`, `hasPrev`, `hasNext`, `prevHref`, `nextHref`, `canonical` are all defined; `PublicLayout` accepts `canonical`.)

- [ ] **Step 3: Manual verification in the dev server**

Run: `npm run dev`

Then verify (the dev server reads the real WordPress, read-only):
1. `http://localhost:4321/articles` — shows 50 articles, header "N 件" with N = total published, and a "次へ →" link at the bottom (with `1 / M`). "前へ" is disabled.
2. `http://localhost:4321/articles?page=2` — shows the next 50, header/`{page}/{totalPages}` correct, "前へ" now enabled.
3. `http://localhost:4321/articles?category=ai-driven-development` — shows only that category's articles, paginated (a "次へ" link appears if that category has >50). Confirm older articles in the category are now reachable via page 2.
4. View source on `/articles?page=2` and confirm `<link rel="canonical" href="https://www.aiojisan.com/articles?page=2">` (self-referencing, not page 1).

Expected: pagination links work as real navigations; category filter paginates server-side; canonical is self-referencing.

- [ ] **Step 4: Commit**

```bash
git add src/pages/articles/index.astro
git commit -m "Paginate public articles list server-side with WP-side category filter"
```

---

## Notes / Out of Scope

- No infinite scroll, no site search, no per-page-size UI, no `rel="next/prev"` meta (real `<a>` links suffice for crawlability).
- A post in multiple pillar categories may show a representative badge that differs from the filtered category; filtering still correctly returns posts belonging to the selected category.
- The extra unfiltered `fetchPostsPage(1)` for the "すべて" count runs only when a category is selected (one small extra request).
