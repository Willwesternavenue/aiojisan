// Featured-image generation: pillar-based provider routing with
// cross-provider fallback and quota-depletion alerting.
//
// Routing: ai-driven-development → gpt-image-2 (OpenAI); everything else
// (physical-ai, generative-ai-news, unknown) → gemini-3-pro-image
// ("Nano Banana Pro"). If the primary provider fails, the other one is
// tried once before giving up.

import { GoogleGenAI } from '@google/genai';
import OpenAI from 'openai';
import { getGoogleAiKey, getOpenAiKey } from '@/lib/env';
import { createLogger } from '@/lib/logger';
import { recordQuotaAlert } from './alerts';

const logger = createLogger('image-provider');

const GEMINI_IMAGE_MODEL = 'gemini-3-pro-image';
const OPENAI_IMAGE_MODEL = 'gpt-image-2';

type Provider = 'gemini' | 'openai';

export interface GeneratedImage {
  buffer: Buffer;
  provider: Provider;
  model: string;
}

function isQuotaError(err: unknown): boolean {
  const msg = String(err);
  return (
    msg.includes('429') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('insufficient_quota') ||
    msg.includes('credits are depleted')
  );
}

async function generateWithGemini(prompt: string): Promise<Buffer> {
  const ai = new GoogleGenAI({ apiKey: getGoogleAiKey() });
  const res = await ai.models.generateContent({
    model: GEMINI_IMAGE_MODEL,
    contents: prompt,
    config: { responseModalities: ['IMAGE', 'TEXT'] },
  });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const parts: any[] = (res as any).candidates?.[0]?.content?.parts ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imgPart = parts.find((p: any) => p.inlineData);
  if (!imgPart?.inlineData?.data) {
    throw new Error(`${GEMINI_IMAGE_MODEL} returned no image data`);
  }
  return Buffer.from(imgPart.inlineData.data, 'base64');
}

async function generateWithOpenAI(prompt: string): Promise<Buffer> {
  const client = new OpenAI({ apiKey: getOpenAiKey() });
  const res = await client.images.generate({
    model: OPENAI_IMAGE_MODEL,
    prompt,
    size: '1536x1024',
    quality: 'medium',
  });
  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error(`${OPENAI_IMAGE_MODEL} returned no image data`);
  return Buffer.from(b64, 'base64');
}

export async function generateFeaturedImageBuffer(
  prompt: string,
  pillar?: string,
): Promise<GeneratedImage> {
  const primary: Provider = pillar === 'ai-driven-development' ? 'openai' : 'gemini';
  const secondary: Provider = primary === 'gemini' ? 'openai' : 'gemini';

  let lastError: unknown;
  for (const provider of [primary, secondary]) {
    try {
      const buffer =
        provider === 'gemini'
          ? await generateWithGemini(prompt)
          : await generateWithOpenAI(prompt);
      const model = provider === 'gemini' ? GEMINI_IMAGE_MODEL : OPENAI_IMAGE_MODEL;
      logger.info('Featured image generated', {
        provider,
        model,
        pillar: pillar ?? '(default)',
        fallbackUsed: provider === secondary,
      });
      return { buffer, provider, model };
    } catch (err) {
      lastError = err;
      if (isQuotaError(err)) {
        void recordQuotaAlert(provider, String(err).slice(0, 500));
      }
      if (provider === primary) {
        logger.warn('Primary image provider failed, falling back', {
          provider,
          pillar: pillar ?? '(default)',
          err: String(err).slice(0, 300),
        });
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`Image generation failed on both providers: ${String(lastError)}`);
}
