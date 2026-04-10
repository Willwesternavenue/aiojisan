// AI service factory — swap providers here without changing call sites

import { openAiProvider } from './openai';
import type { AiProvider } from '@/types/ai';

// Currently only OpenAI is implemented.
// TODO: add Anthropic provider when needed.
export function getAiProvider(): AiProvider {
  return openAiProvider;
}

export type { AiProvider };
