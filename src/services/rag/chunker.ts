// Blog post chunker
// Splits blog post content into RAG-ready chunks
// Target: 300–800 Japanese characters per chunk

const TARGET_MIN = 300;
const TARGET_MAX = 800;

export interface RawChunk {
  sectionTitle: string | null;
  text: string;
  index: number;
}

// ── Heading-based chunking (preferred) ───────────────────────────────────────

function chunkByHeadings(content: string): RawChunk[] {
  const lines = content.split('\n');
  const chunks: RawChunk[] = [];

  let currentTitle: string | null = null;
  let buffer: string[] = [];
  let chunkIndex = 0;

  function flush() {
    const text = buffer.join('\n').trim();
    if (!text) return;

    // Split if too long
    if (text.length > TARGET_MAX * 1.5) {
      const subChunks = splitByLength(text);
      for (const sub of subChunks) {
        chunks.push({ sectionTitle: currentTitle, text: sub, index: chunkIndex++ });
      }
    } else if (text.length >= TARGET_MIN) {
      chunks.push({ sectionTitle: currentTitle, text, index: chunkIndex++ });
    } else if (chunks.length > 0) {
      // Merge short fragment into previous chunk
      const last = chunks[chunks.length - 1]!;
      const merged = last.text + '\n\n' + text;
      if (merged.length <= TARGET_MAX * 1.5) {
        chunks[chunks.length - 1] = { ...last, text: merged.trim() };
        return;
      }
      // If merged would be too long, keep as separate chunk
      chunks.push({ sectionTitle: currentTitle, text, index: chunkIndex++ });
    } else {
      // First chunk is short — keep it
      chunks.push({ sectionTitle: currentTitle, text, index: chunkIndex++ });
    }
  }

  for (const line of lines) {
    const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
    if (headingMatch) {
      flush();
      buffer = [];
      currentTitle = headingMatch[1] ?? null;
    } else {
      buffer.push(line);
    }
  }
  flush();

  return chunks;
}

// ── Paragraph-based chunking (fallback) ──────────────────────────────────────

function chunkByParagraphs(content: string): RawChunk[] {
  const paragraphs = content
    .split(/\n{2,}/)
    .map(p => p.trim())
    .filter(p => p.length > 0);

  const chunks: RawChunk[] = [];
  let buffer = '';
  let chunkIndex = 0;

  for (const para of paragraphs) {
    const candidate = buffer ? buffer + '\n\n' + para : para;

    if (candidate.length > TARGET_MAX) {
      if (buffer) {
        chunks.push({ sectionTitle: null, text: buffer.trim(), index: chunkIndex++ });
        buffer = para;
      } else {
        // Single very long paragraph — split by length
        for (const sub of splitByLength(para)) {
          chunks.push({ sectionTitle: null, text: sub, index: chunkIndex++ });
        }
      }
    } else {
      buffer = candidate;
    }
  }

  if (buffer.trim()) {
    // Merge trailing short buffer into last chunk if possible
    if (buffer.trim().length < TARGET_MIN && chunks.length > 0) {
      const last = chunks[chunks.length - 1]!;
      chunks[chunks.length - 1] = {
        ...last,
        text: last.text + '\n\n' + buffer.trim(),
      };
    } else {
      chunks.push({ sectionTitle: null, text: buffer.trim(), index: chunkIndex++ });
    }
  }

  return chunks;
}

// ── Length-based split ────────────────────────────────────────────────────────

function splitByLength(text: string): string[] {
  const results: string[] = [];
  for (let i = 0; i < text.length; i += TARGET_MAX) {
    results.push(text.slice(i, i + TARGET_MAX));
  }
  return results;
}

// ── Public API ────────────────────────────────────────────────────────────────

export function chunkPostContent(content: string): RawChunk[] {
  const hasHeadings = /^#{1,3}\s+.+/m.test(content);
  const chunks = hasHeadings
    ? chunkByHeadings(content)
    : chunkByParagraphs(content);

  // Filter out empty / very short chunks
  return chunks.filter(c => c.text.trim().length >= 50);
}
