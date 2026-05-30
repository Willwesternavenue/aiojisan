// Types for AI service layer

export interface ArticleSummaryInput {
  title: string;
  url: string;
  extractedText: string;
  publishedAt: string | null;
  sourceName: string;
}

export interface ArticleSummaryOutput {
  shortSummary: string;
  longSummary: string;
  tags: string[];
  topics: string[];
}

export interface EditorialScoreOutput {
  aiOjisanFitScore: number;       // 0-10: relevance to AIおじさん's editorial interests
  blogPostPotentialScore: number;  // 0-10: potential as a blog post
  xPostPotentialScore: number;    // 0-10: potential as an X post
  noveltyScore: number;           // 0-10: newsworthiness / freshness
  sourceReliabilityScore: number; // 0-10: estimated source quality
  overallScore: number;           // 0-10: composite score
  reasoning: string;
}

export interface BlogDraftInput {
  articleTitle: string;
  articleUrl: string;
  articleText: string;
  shortSummary: string;
  longSummary: string;
  topics: string[];
  styleChunks: string[];  // Retrieved RAG chunks for style guidance
}

export type XPostInput = Pick<BlogDraftInput, 'articleTitle' | 'articleUrl' | 'shortSummary' | 'topics'>;

export interface BlogDraftOutput {
  titleOptions: [string, string, string];
  slug: string;
  outline: string;
  body: string;
  model: string;  // Actual model used to generate the draft
}

export interface XPostDraftOutput {
  direct: string;       // 直球・要点型
  analytical: string;   // 知的・分析型
  opinion: string;      // 少し強めの意見型
}

export interface AiProvider {
  summarizeArticle(input: ArticleSummaryInput): Promise<ArticleSummaryOutput>;
  scoreArticle(input: ArticleSummaryInput & { summary: string }): Promise<EditorialScoreOutput>;
  generateBlogDraft(input: BlogDraftInput): Promise<BlogDraftOutput>;
  generateXPosts(input: XPostInput): Promise<XPostDraftOutput>;
  generateEmbedding(text: string): Promise<number[]>;
}
