import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { GENERATE_BLOG_DRAFT_PROMPT, GENERATE_TOPIC_DRAFT_PROMPT } from './prompts';
import type { BlogDraftInput, BlogDraftOutput, TopicDraftInput } from '@/types/ai';

const logger = createLogger('anthropic');

const DRAFT_MODEL = 'claude-sonnet-4-6';

// Structured-output tool: forcing tool use makes Claude return a validated
// object (SDK gives us `.input` already parsed) instead of free-text JSON,
// eliminating the escaping bugs that broke naive JSON.parse on long bodies.
const DRAFT_TOOL: Anthropic.Tool = {
  name: 'submit_blog_draft',
  description: 'ブログ下書きを提出する。titleOptionsは3案、outlineとbodyはマークダウン。',
  input_schema: {
    type: 'object',
    properties: {
      titleOptions: {
        type: 'array',
        items: { type: 'string' },
        description: 'タイトル案（3つ）',
      },
      slug: { type: 'string', description: '英語・小文字・ハイフン区切りのURLスラッグ' },
      outline: { type: 'string', description: 'マークダウンのアウトライン' },
      body: { type: 'string', description: '本文全文（マークダウン形式）' },
    },
    required: ['titleOptions', 'slug', 'outline', 'body'],
  },
};

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

export async function generateBlogDraftWithClaude(input: BlogDraftInput): Promise<BlogDraftOutput> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });

  const styleChunkText = input.styleChunks.length > 0
    ? input.styleChunks.map((c, i) => `[サンプル${i + 1}]\n${c}`).join('\n\n')
    : '（文体サンプルなし）';

  const prompt = fillTemplate(GENERATE_BLOG_DRAFT_PROMPT, {
    articleTitle: input.articleTitle,
    articleUrl: input.articleUrl,
    shortSummary: input.shortSummary,
    longSummary: input.longSummary,
    articleText: input.articleText.slice(0, 8000),
    styleChunks: styleChunkText,
  });

  logger.info('Generating blog draft with Claude', { title: input.articleTitle, model: DRAFT_MODEL });

  const message = await client.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 8192,
    tools: [DRAFT_TOOL],
    tool_choice: { type: 'tool', name: 'submit_blog_draft' },
    messages: [{ role: 'user', content: prompt }],
  });

  if (message.stop_reason === 'max_tokens') {
    logger.warn('Claude draft hit max_tokens — output likely truncated, consider raising the limit', {
      title: input.articleTitle,
      model: DRAFT_MODEL,
    });
  }

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    logger.error('Claude did not return the draft tool call', { stopReason: message.stop_reason });
    throw new Error('Claude draft generation: no structured output');
  }

  const raw = toolUse.input as { titleOptions: unknown; slug: string; outline: string; body: string };

  const titleOptions = normalizeTitleOptions(raw.titleOptions);

  const slug = (raw.slug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'ai-article';

  return {
    titleOptions,
    slug,
    outline: raw.outline,
    body: raw.body,
    model: DRAFT_MODEL,
  };
}

// Claude occasionally returns the titleOptions array field as a (sometimes
// malformed) JSON-encoded string instead of a real array — observed in
// production: draft_title became "[" because selectedTitle picked the first
// CHARACTER of the string. Normalize defensively: real array → JSON.parse →
// tolerant bracket/quote split → throw.
function normalizeTitleOptions(value: unknown): [string, string, string] {
  const toTriple = (arr: unknown[]): [string, string, string] | null => {
    const strings = arr.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    if (strings.length === 0) return null;
    return [strings[0], strings[1] ?? strings[0], strings[2] ?? strings[0]];
  };

  if (Array.isArray(value)) {
    const triple = toTriple(value);
    if (triple) return triple;
  }

  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        const triple = toTriple(parsed);
        if (triple) return triple;
      }
    } catch {
      // fall through to tolerant split (handles unescaped inner quotes)
    }
    const inner = value.trim().replace(/^\[\s*"?/, '').replace(/"?\s*\]$/, '');
    const parts = inner.split(/"\s*,\s*"/).map(part => part.trim()).filter(Boolean);
    const triple = toTriple(parts);
    if (triple) return triple;
  }

  throw new Error('Claude draft generation: invalid titleOptions');
}

// Topic-directed draft for the personal blog. Same structured-output tool as
// the news draft, but the prompt is voice-first and research-backed instead of
// being anchored to a source article.
export async function generateTopicDraftWithClaude(input: TopicDraftInput): Promise<BlogDraftOutput> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });

  const styleChunkText = input.styleChunks.length > 0
    ? input.styleChunks.map((c, i) => `[サンプル${i + 1}]\n${c}`).join('\n\n')
    : '（文体サンプルなし）';

  const sourceList = input.sources.length > 0
    ? input.sources.map(s => `- [${s.title}](${s.url})`).join('\n')
    : '（参照した情報源なし）';

  const prompt = fillTemplate(GENERATE_TOPIC_DRAFT_PROMPT, {
    topic: input.topic,
    angle: input.angle ?? '（指定なし）',
    findings: input.findings || '（下調べの結果なし）',
    sourceList,
    styleChunks: styleChunkText,
  });

  logger.info('Generating topic draft with Claude', {
    topic: input.topic.slice(0, 80),
    model: DRAFT_MODEL,
    sources: input.sources.length,
    styleChunks: input.styleChunks.length,
  });

  const message = await client.messages.create({
    model: DRAFT_MODEL,
    max_tokens: 8192,
    tools: [DRAFT_TOOL],
    tool_choice: { type: 'tool', name: 'submit_blog_draft' },
    messages: [{ role: 'user', content: prompt }],
  });

  if (message.stop_reason === 'max_tokens') {
    logger.warn('Topic draft hit max_tokens — output likely truncated', {
      topic: input.topic.slice(0, 80),
      model: DRAFT_MODEL,
    });
  }

  const toolUse = message.content.find((block) => block.type === 'tool_use');
  if (!toolUse || toolUse.type !== 'tool_use') {
    logger.error('Claude did not return the topic draft tool call', { stopReason: message.stop_reason });
    throw new Error('Claude topic draft generation: no structured output');
  }

  const raw = toolUse.input as { titleOptions: unknown; slug: string; outline: string; body: string };

  const titleOptions = normalizeTitleOptions(raw.titleOptions);

  const slug = (raw.slug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'blog-post';

  return {
    titleOptions,
    slug,
    outline: raw.outline,
    body: raw.body,
    model: DRAFT_MODEL,
  };
}
