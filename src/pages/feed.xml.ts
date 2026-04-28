import type { APIRoute } from 'astro';

type WpPost = {
  slug: string;
  date: string;
  modified?: string;
  title: { rendered: string };
  excerpt: { rendered: string };
};

const SITE_TITLE = 'AIおじさんのひとりごと';
const SITE_DESCRIPTION = '生成AI、AI駆動開発、フィジカルAIを実務目線で読み解くニュース分析メディア';

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function formatRssDate(value?: string): string {
  const date = value ? new Date(value) : new Date();
  return Number.isNaN(date.getTime())
    ? new Date().toUTCString()
    : date.toUTCString();
}

async function fetchWpPosts(limit = 20): Promise<WpPost[]> {
  const base = import.meta.env.WORDPRESS_BASE_URL?.replace(/\/$/, '') ?? '';
  if (!base) return [];

  try {
    const params = new URLSearchParams({
      per_page: String(limit),
      status: 'publish',
      orderby: 'date',
      order: 'desc',
      _fields: 'slug,date,modified,title,excerpt',
    });
    const res = await fetch(`${base}/wp-json/wp/v2/posts?${params}`);
    if (!res.ok) return [];
    return res.json();
  } catch {
    return [];
  }
}

export const GET: APIRoute = async ({ request }) => {
  const origin = new URL(request.url).origin;
  const siteUrl = `${origin}/`;
  const feedUrl = `${origin}/feed.xml`;
  const posts = await fetchWpPosts();
  const lastBuildDate = formatRssDate(posts[0]?.modified ?? posts[0]?.date);

  const items = posts.map(post => {
    const articleUrl = `${origin}/articles/${post.slug}`;
    const title = stripHtml(post.title.rendered);
    const description = stripHtml(post.excerpt.rendered);

    return `    <item>
      <title>${escapeXml(title)}</title>
      <link>${escapeXml(articleUrl)}</link>
      <guid isPermaLink="true">${escapeXml(articleUrl)}</guid>
      <pubDate>${formatRssDate(post.date)}</pubDate>
      <description>${escapeXml(description)}</description>
    </item>`;
  }).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${escapeXml(SITE_TITLE)}</title>
    <link>${escapeXml(siteUrl)}</link>
    <description>${escapeXml(SITE_DESCRIPTION)}</description>
    <language>ja</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
    <atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml" />
${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/rss+xml; charset=utf-8',
      'Cache-Control': 'public, max-age=1800',
    },
  });
};
