import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { GENERATE_BLOG_DRAFT_PROMPT } from './prompts';
import type { BlogDraftInput, BlogDraftOutput } from '@/types/ai';

const logger = createLogger('anthropic');

const DRAFT_MODEL = 'claude-sonnet-4-6';

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
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Claude returned non-text content');

  // Strip markdown code fences if present
  const jsonText = content.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();

  let raw: { titleOptions: [string, string, string]; slug: string; outline: string; body: string };
  try {
    raw = JSON.parse(jsonText);
  } catch {
    logger.error('Failed to parse Claude JSON response', { text: content.text.slice(0, 500) });
    throw new Error('Claude draft generation: invalid JSON response');
  }

  const slug = (raw.slug ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    || 'ai-article';

  return {
    titleOptions: raw.titleOptions,
    slug,
    outline: raw.outline,
    body: raw.body,
  };
}
