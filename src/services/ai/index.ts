// AI service factory — swap providers here without changing call sites

import { openAiProvider } from './openai';
import { generateBlogDraftWithClaude } from './anthropic';
import type { AiProvider } from '@/types/ai';

// Hybrid provider: Claude Sonnet 4.6 for draft generation, OpenAI for everything else
const hybridProvider: AiProvider = {
  ...openAiProvider,
  generateBlogDraft: generateBlogDraftWithClaude,
};

export function getAiProvider(): AiProvider {
  return hybridProvider;
}

export type { AiProvider };
