import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { GENERATE_BLOG_DRAFT_PROMPT } from './prompts';
import type { BlogDraftInput, BlogDraftOutput } from '@/types/ai';

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

  const raw = toolUse.input as { titleOptions: [string, string, string]; slug: string; outline: string; body: string };

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
    model: DRAFT_MODEL,
  };
}
