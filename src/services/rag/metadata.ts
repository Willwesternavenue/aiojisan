// Chunk metadata extraction via LLM
// Generates topic_tags, tone_tag, structure_type, style_tags for each chunk

import { getAiProvider } from '@/services/ai';
import { createLogger } from '@/lib/logger';

const logger = createLogger('rag-metadata');

export interface ChunkMetadata {
  topicTags: string[];
  toneTag: string;
  structureType: string;
  styleTags: string[];
}

const METADATA_PROMPT = `
あなたはブログ記事チャンクのメタデータ抽出AIです。
以下の文章チャンクを分析し、JSON形式でメタデータを返してください。

## チャンク
{chunk}

## 出力形式（JSONのみ）
{
  "topicTags": ["AI", "生成AI"],
  "toneTag": "実務的",
  "structureType": "問題提起→解説→示唆",
  "styleTags": ["率直", "段落短め", "実務感あり"]
}

## 選択肢

### toneTag（1つ選ぶ）
知的 / 実務的 / 軽快 / 解説寄り / やや強め / エッセイ寄り

### structureType（1つ選ぶ）
要点先出し / 問題提起→解説→示唆 / ニュース要約→見解 / 比較型 / 仮説提示型 / 実務論点整理型

### styleTags（当てはまるものを複数）
率直 / 実務感あり / 段落短め / 比喩少なめ / 断定控えめ / 論点整理型 / 読みやすい / 少し会話的
`.trim();

export async function extractChunkMetadata(chunkText: string): Promise<ChunkMetadata> {
  const ai = getAiProvider();

  // Use embedding + quick classification — reuse generateEmbedding's client
  // For metadata we call the AI directly with a structured prompt
  const prompt = METADATA_PROMPT.replace('{chunk}', chunkText.slice(0, 600));

  try {
    // Reuse OpenAI client via a simple chat call
    // We don't have a generic "callLlm" method on AiProvider yet,
    // so we use the OpenAI client directly here
    const OpenAI = (await import('openai')).default;
    const { getOpenAiKey } = await import('@/lib/env');
    const client = new OpenAI({ apiKey: getOpenAiKey() });

    const res = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    });

    const content = res.choices[0]?.message?.content;
    if (!content) throw new Error('Empty metadata response');

    const raw = JSON.parse(content) as {
      topicTags?: string[];
      toneTag?: string;
      structureType?: string;
      styleTags?: string[];
    };

    return {
      topicTags: raw.topicTags ?? [],
      toneTag: raw.toneTag ?? '',
      structureType: raw.structureType ?? '',
      styleTags: raw.styleTags ?? [],
    };
  } catch (err) {
    logger.warn('Metadata extraction failed, using defaults', { err: String(err) });
    return { topicTags: [], toneTag: '', structureType: '', styleTags: [] };
  }
}
