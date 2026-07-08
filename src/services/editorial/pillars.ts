export type PillarSlug = 'physical-ai' | 'ai-driven-development' | 'overseas-ai-business' | 'generative-ai-news';

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
    name: '海外AIビジネス',
    slug: 'overseas-ai-business',
    description: '海外AI企業・スタートアップの収益モデル、資金調達、M&A、市場構造に関する記事',
    keywords: [
      '資金調達',
      'funding',
      'raises',
      'series a',
      'series b',
      'series c',
      'valuation',
      '評価額',
      'ipo',
      'm&a',
      '買収',
      'acquisition',
      'startup',
      'スタートアップ',
      'y combinator',
      'vc',
      'venture capital',
      'ベンチャーキャピタル',
      'ビジネスモデル',
      '収益モデル',
      'arr',
      'unicorn',
      'ユニコーン',
      'crunchbase',
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
    : [PILLAR_CATEGORIES.find(category => category.slug === 'generative-ai-news')!];
}

export function includesPhysicalAi(categories: Pick<PillarCategory, 'slug'>[]): boolean {
  return categories.some(category => category.slug === 'physical-ai');
}

// Display copy for the public pages (order = display order; intentionally
// different from the detection order of PILLAR_CATEGORIES above).
export type EditorialDisplayCategory = {
  slug: PillarSlug;
  label: string;
  description: string;
};

export const EDITORIAL_DISPLAY_CATEGORIES: EditorialDisplayCategory[] = [
  {
    slug: 'generative-ai-news',
    label: '生成AIニュース',
    description: 'モデル、プロダクト、研究、企業導入、政策などAI全般の動き',
  },
  {
    slug: 'ai-driven-development',
    label: 'AI駆動開発',
    description: 'コーディングエージェント、開発プロセス、DevOps、PM/QA',
  },
  {
    slug: 'physical-ai',
    label: 'フィジカルAI',
    description: 'ロボット、ヒューマノイド、自動運転、製造・物流現場のAI',
  },
  {
    slug: 'overseas-ai-business',
    label: '海外AIビジネス',
    description: '海外AI企業の収益モデル、資金調達、スタートアップの勝ち筋',
  },
];
