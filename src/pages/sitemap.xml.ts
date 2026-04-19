import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ request }) => {
  const origin = new URL(request.url).origin;
  const base = import.meta.env.WORDPRESS_BASE_URL?.replace(/\/$/, '') ?? '';

  // Static pages
  const staticPages = [
    { url: `${origin}/`, priority: '1.0', changefreq: 'daily' },
    { url: `${origin}/articles`, priority: '0.9', changefreq: 'daily' },
    { url: `${origin}/about`, priority: '0.5', changefreq: 'monthly' },
  ];

  // Fetch all published posts from WordPress
  let wpPosts: Array<{ slug: string; modified: string }> = [];
  try {
    let page = 1;
    while (true) {
      const res = await fetch(
        `${base}/wp-json/wp/v2/posts?per_page=100&status=publish&_fields=slug,modified&page=${page}`,
      );
      if (!res.ok) break;
      const batch: Array<{ slug: string; modified: string }> = await res.json();
      if (batch.length === 0) break;
      wpPosts = wpPosts.concat(batch);
      if (batch.length < 100) break;
      page++;
    }
  } catch {
    // Return sitemap with static pages only if WP is unreachable
  }

  const articleEntries = wpPosts.map(p => ({
    url: `${origin}/articles/${p.slug}`,
    lastmod: p.modified ? p.modified.slice(0, 10) : undefined,
    priority: '0.8',
    changefreq: 'weekly',
  }));

  const allEntries = [...staticPages, ...articleEntries];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${allEntries
  .map(entry => `  <url>
    <loc>${entry.url}</loc>${entry.lastmod ? `\n    <lastmod>${entry.lastmod}</lastmod>` : ''}
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`)
  .join('\n')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
