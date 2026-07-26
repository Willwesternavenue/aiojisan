// Topic research via Claude's server-side web search tool. Returns prose
// findings plus the URLs Claude actually consulted, so the draft can cite them.

import Anthropic from '@anthropic-ai/sdk';
import { getAnthropicKey } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import type { ResearchSource } from '@/types/ai';

const logger = createLogger('research');

const RESEARCH_MODEL = 'claude-sonnet-4-6';
const MAX_SEARCHES = 5;

export interface TopicResearch {
  findings: string;
  sources: ResearchSource[];
}

export async function researchTopic(topic: string, angle?: string): Promise<TopicResearch> {
  const client = new Anthropic({ apiKey: getAnthropicKey() });

  const prompt =
    `次のトピックについて、日本語のブログ記事を書くための下調べをしてください。\n\n` +
    `## トピック\n${topic}\n\n` +
    (angle ? `## 切り口・補足\n${angle}\n\n` : '') +
    `## 指示\n` +
    `- 必要に応じてWeb検索を使い、最新の事実・数字・固有名詞・日付を集める\n` +
    `- 出典が確認できた事実と、一般論・背景知識を区別して書く\n` +
    `- 箇条書き中心で、記事の材料になる粒度でまとめる\n` +
    `- 推測で数字や固有名詞を作らない`;

  logger.info('Researching topic', { topic: topic.slice(0, 80), model: RESEARCH_MODEL });

  const message = await client.messages.create({
    model: RESEARCH_MODEL,
    max_tokens: 4096,
    tools: [
      {
        type: 'web_search_20250305',
        name: 'web_search',
        max_uses: MAX_SEARCHES,
      } as unknown as Anthropic.Tool,
    ],
    messages: [{ role: 'user', content: prompt }],
  });

  const findings = message.content
    .filter((block): block is Anthropic.TextBlock => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .trim();

  const sources = extractSources(message.content);

  logger.info('Research complete', { findingsLength: findings.length, sources: sources.length });

  return { findings, sources };
}

// Pull cited URLs out of both web_search results and inline citations.
function extractSources(content: unknown[]): ResearchSource[] {
  const seen = new Map<string, string>();

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!node || typeof node !== 'object') return;

    const record = node as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url : null;
    if (url && url.startsWith('http') && !seen.has(url)) {
      const title = typeof record.title === 'string' && record.title.trim().length > 0
        ? record.title.trim()
        : url;
      seen.set(url, title);
    }

    for (const value of Object.values(record)) {
      if (value && typeof value === 'object') visit(value);
    }
  };

  visit(content);

  return [...seen.entries()].map(([url, title]) => ({ url, title })).slice(0, 10);
}
