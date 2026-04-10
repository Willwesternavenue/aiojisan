// Types for the ingestion pipeline

export interface RawArticleCandidate {
  url: string;
  title?: string;
  publishedAt?: string;
  excerpt?: string;
}

export interface ExtractedArticle {
  originalUrl: string;
  canonicalUrl: string;
  title: string;
  author: string | null;
  publishedAt: string | null;
  rawHtml: string;
  extractedText: string;
  excerpt: string | null;
  mainImageUrl: string | null;
  language: string;
  hash: string;
}

export interface ExtractionConfig {
  titleSelector?: string;
  bodySelector?: string;
  authorSelector?: string;
  dateSelector?: string;
  excludeSelectors?: string[];
}

export interface IngestionResult {
  sourceId: string;
  itemsFound: number;
  itemsInserted: number;
  errors: string[];
}
