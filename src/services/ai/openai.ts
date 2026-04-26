// OpenAI provider implementation
// Implements the AiProvider interface

import OpenAI from 'openai';
import { getOpenAiKey } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import {
  SUMMARIZE_ARTICLE_PROMPT,
  SCORE_ARTICLE_PROMPT,
  GENERATE_BLOG_DRAFT_PROMPT,
  GENERATE_X_POSTS_PROMPT,
} from './prompts';
import type {
  AiProvider,
  ArticleSummaryInput,
  ArticleSummaryOutput,
  EditorialScoreOutput,
  BlogDraftInput,
  BlogDraftOutput,
  XPostDraftOutput,
} from '@/types/ai';

const logger = createLogger('openai');

const SUMMARY_MODEL = 'gpt-4o-mini';
const DRAFT_MODEL   = 'gpt-4o';
const EMBED_MODEL   = 'text-embedding-3-small';

function getClient(): OpenAI {
  return new OpenAI({ apiKey: getOpenAiKey() });
}

function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

async function callJson<T>(
  client: OpenAI,
  model: string,
  prompt: string,
  context: string,
): Promise<T> {
  const response = await client.chat.completions.create({
    model,
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.3,
  });

  const content = response.choices[0]?.message?.content;
  if (!content) throw new Error(`${context}: empty response`);

  try {
    return JSON.parse(content) as T;
  } catch {
    logger.error(`${context}: failed to parse JSON`, { content });
    throw new Error(`${context}: invalid JSON response`);
  }
}

export const openAiProvider: AiProvider = {
  async summarizeArticle(input: ArticleSummaryInput): Promise<ArticleSummaryOutput> {
    const client = getClient();
    // Truncate text to avoid token limits
    const truncatedText = input.extractedText.slice(0, 8000);

    const prompt = fillTemplate(SUMMARIZE_ARTICLE_PROMPT, {
      title: input.title,
      url: input.url,
      sourceName: input.sourceName,
      publishedAt: input.publishedAt ?? '不明',
      extractedText: truncatedText,
    });

    logger.info('Summarizing article', { title: input.title });
    const raw = await callJson<{
      shortSummary: string;
      longSummary: string;
      tags: string[];
      topics: string[];
    }>(client, SUMMARY_MODEL, prompt, 'summarizeArticle');

    return {
      shortSummary: raw.shortSummary,
      longSummary: raw.longSummary,
      tags: raw.tags ?? [],
      topics: raw.topics ?? [],
    };
  },

  async scoreArticle(
    input: ArticleSummaryInput & { summary: string },
  ): Promise<EditorialScoreOutput> {
    const client = getClient();

    const prompt = fillTemplate(SCORE_ARTICLE_PROMPT, {
      title: input.title,
      url: input.url,
      sourceName: input.sourceName,
      summary: input.summary,
    });

    logger.info('Scoring article', { title: input.title });
    const raw = await callJson<{
      aiOjisanFitScore: number;
      blogPostPotentialScore: number;
      xPostPotentialScore: number;
      noveltyScore: number;
      sourceReliabilityScore: number;
      overallScore: number;
      reasoning: string;
    }>(client, SUMMARY_MODEL, prompt, 'scoreArticle');

    return {
      aiOjisanFitScore: raw.aiOjisanFitScore,
      blogPostPotentialScore: raw.blogPostPotentialScore,
      xPostPotentialScore: raw.xPostPotentialScore,
      noveltyScore: raw.noveltyScore,
      sourceReliabilityScore: raw.sourceReliabilityScore,
      overallScore: raw.overallScore,
      reasoning: raw.reasoning,
    };
  },

  async generateBlogDraft(input: BlogDraftInput): Promise<BlogDraftOutput> {
    const client = getClient();

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

    logger.info('Generating blog draft', { title: input.articleTitle });
    const raw = await callJson<{
      titleOptions: [string, string, string];
      slug: string;
      outline: string;
      body: string;
    }>(client, DRAFT_MODEL, prompt, 'generateBlogDraft');

    // Sanitize slug: lowercase, hyphens only, no Japanese
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
  },

  async generateXPosts(
    input: Pick<BlogDraftInput, 'articleTitle' | 'articleUrl' | 'shortSummary' | 'topics'>,
  ): Promise<XPostDraftOutput> {
    const client = getClient();

    const prompt = fillTemplate(GENERATE_X_POSTS_PROMPT, {
      articleTitle: input.articleTitle,
      articleUrl: input.articleUrl,
      shortSummary: input.shortSummary,
      topics: input.topics.join(', '),
      url: input.articleUrl,
    });

    logger.info('Generating X posts', { title: input.articleTitle });
    const raw = await callJson<{
      direct: string;
      analytical: string;
      opinion: string;
    }>(client, SUMMARY_MODEL, prompt, 'generateXPosts');

    return {
      direct: raw.direct,
      analytical: raw.analytical,
      opinion: raw.opinion,
    };
  },

  async generateEmbedding(text: string): Promise<number[]> {
    const client = getClient();
    const response = await client.embeddings.create({
      model: EMBED_MODEL,
      input: text.slice(0, 8000), // Truncate for safety
    });
    return response.data[0]?.embedding ?? [];
  },
};
