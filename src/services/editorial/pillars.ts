export type PillarSlug = 'physical-ai' | 'ai-driven-development' | 'generative-ai-news';

export type PillarCategory = {
  name: string;
  slug: PillarSlug;
  description: string;
  keywords: string[];
};

export const PILLAR_CATEGORIES: PillarCategory[] = [
  {
    name: 'フィジカルAI',
    slug: 'physical-ai',
    description: 'ロボット、身体性、自動運転、製造現場など、現実世界で動くAIに関する記事',
    keywords: [
      'フィジカルai',
      'physical ai',
      'robot',
      'robotics',
      'robotic',
      'humanoid',
      'android',
      'embodied ai',
      'world model',
      'spatial intelligence',
      'ロボット',
      'ロボティクス',
      'ヒューマノイド',
      '人型ロボット',
      '身体性',
      '具身化',
      '実世界',
      '自動運転',
      'ドローン',
      '製造現場',
      '工場',
      '倉庫',
    ],
  },
  {
    name: 'AI駆動開発',
    slug: 'ai-driven-development',
    description: 'AIエージェント、コーディング支援、開発プロセス、DevOps、PM/QAに関する記事',
    keywords: [
      'ai駆動開発',
      'agentic engineering',
      'vibe coding',
      'coding agent',
      'code agent',
      'ai coding',
      'aiエージェント',
      'コーディングエージェント',
      'claude code',
      'codex',
      'cursor',
      'devops',
      'ci/cd',
      'pull request',
      'github',
      'qa',
      'テスト自動化',
      '開発プロセス',
      'ソフトウェア開発',
      'エンジニアリング',
    ],
  },
  {
    name: '生成AIニュース',
    slug: 'generative-ai-news',
    description: '生成AIのモデル、プロダクト、企業導入、政策、研究、産業動向に関する記事',
    keywords: [
      '生成ai',
      'generative ai',
      'llm',
      'large language model',
      'chatgpt',
      'openai',
      'anthropic',
      'claude',
      'gemini',
      'google ai',
      'microsoft ai',
      '画像生成',
      '動画生成',
      'マルチモーダル',
      'aiモデル',
      '基盤モデル',
      '企業導入',
    ],
  },
];

export function detectPillarCategories(fields: Array<string | null | undefined>): PillarCategory[] {
  const haystack = fields
    .filter(Boolean)
    .join('\n')
    .toLowerCase();

  const matched = PILLAR_CATEGORIES.filter(category =>
    category.keywords.some(keyword => haystack.includes(keyword)),
  );

  return matched.length > 0
    ? matched
    : [PILLAR_CATEGORIES[2]];
}

export function includesPhysicalAi(categories: Pick<PillarCategory, 'slug'>[]): boolean {
  return categories.some(category => category.slug === 'physical-ai');
}
