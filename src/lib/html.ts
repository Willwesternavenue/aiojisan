// Shared HTML text utilities for WordPress "rendered" fields.

// Decode numeric (dec/hex) and common named HTML entities. WordPress
// texturizes titles/excerpts into entities like &#8221; — without numeric
// decoding these show up literally on the page (mojibake).
export function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&'); // keep last so it doesn't double-decode
}

// Strip tags then decode entities — for WP title.rendered / excerpt.rendered.
export function stripHtml(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}
