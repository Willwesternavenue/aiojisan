// Shared blog-draft content generation (used by generate and regenerate)

import { getAiProvider } from '@/services/ai';
import { getStyleChunksForDraft } from '@/services/rag/retrieval';
import type { BlogDraftOutput } from '@/types/ai';

export interface ArticleForDraft {
  title: string;
  canonical_url: string;
  extracted_text: string | null;
  article_ai_insights: {
    short_summary: string | null;
    long_summary: string | null;
    topics: string[] | null;
  } | null;
}

/**
 * Run the AI draft generation step for an article (fetch style chunks + call
 * the blog-draft model). Returns the generated draft and how many style chunks
 * were used so callers can record it in metadata.
 */
export async function buildBlogDraftForArticle(
  article: ArticleForDraft,
): Promise<{ draft: BlogDraftOutput; styleChunksUsed: number }> {
  const ai = getAiProvider();
  const insights = article.article_ai_insights;
  const styleChunks = await getStyleChunksForDraft(article.title, insights?.topics ?? []);
  const draft = await ai.generateBlogDraft({
    articleTitle: article.title,
    articleUrl: article.canonical_url,
    articleText: article.extracted_text ?? '',
    shortSummary: insights?.short_summary ?? '',
    longSummary: insights?.long_summary ?? '',
    topics: insights?.topics ?? [],
    styleChunks,
  });
  return { draft, styleChunksUsed: styleChunks.length };
}
