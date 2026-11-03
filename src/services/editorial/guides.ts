/**
 * Guides are the hub (pillar) pages: one topic, a top-down read, and an
 * explicit map from each heading to the existing articles that go deeper.
 *
 * The mapping lives here rather than in WordPress bodies so that the reverse
 * link (article -> guide) can be rendered by code, and so that adding an
 * article to a guide is a one-line change instead of an edit to two posts.
 */
import type { PillarSlug } from './pillars';

export type GuideSection = {
  /** Anchor id; also the key used by the article -> guide reverse lookup. */
  id: string;
  heading: string;
  /** One string per paragraph. */
  body: string[];
  /** WordPress slugs, in display order. Missing posts are skipped at render. */
  articles?: string[];
  /** One level of nesting only (the threat taxonomy uses it). */
  sections?: GuideSection[];
};

export type Guide = {
  slug: string;
  /** H1 on the page. */
  title: string;
  /** Meta description and OG description. */
  description: string;
  /** One string per lead paragraph; the first sentence carries the answer. */
  lead: string[];
  /** Last substantive review of the prose, not of the linked articles. */
  reviewedOn: string;
  pillar: PillarSlug;
  /** Primary first; used for internal bookkeeping, not rendered as a list. */
  keywords: string[];
  sections: GuideSection[];
  /** Rendered as a copyable checklist near the end of the page. */
  checklist?: { heading: string; intro: string; items: string[] };
  /**
   * Keeps the "最新動向" block current without a monthly manual edit: a recent
   * post is listed when its title carries BOTH a domain word and an aspect
   * word. One list alone is too loose — "ロボット" on its own pulls in business
   * news, "セキュリティ" on its own pulls in model releases.
   */
  freshness?: { domain: string[]; aspect: string[] };
  seeAlso?: { href: string; label: string; description: string }[];
};

const PHYSICAL_AI_SECURITY: Guide = {
  slug: 'physical-ai-security',
  title: 'フィジカルAIのセキュリティと安全設計入門【工場・ロボット導入前に読むガイド】',
  description:
    'ロボットや工場にAIを入れる前に押さえるべき脅威と安全設計を1本で整理したガイド。プロンプトインジェクション、認証情報、センサー改ざん、エッジ機器、サプライチェーンの5つの入口と、決定論的な監視層という考え方、導入前チェックリストまで。',
  lead: [
    'フィジカルAIのリスクは、言葉の誤りがそのまま物理的な動作になることにあります。チャットボットなら誤答で済むものが、ロボットアームでは可動域の中の人や設備に届きます。',
    'このページは、ロボット・製造現場にAIを入れる立場の人向けに「何が危ないか」と「どう設計するか」をまとめた入口です。各節から、個別の事例や実装を扱った記事に入れます。',
  ],
  reviewedOn: '2026-11-03',
  pillar: 'physical-ai',
  keywords: [
    'フィジカルAI セキュリティ',
    'フィジカルAI 安全性',
    'ロボット LLM リスク',
    'プロンプトインジェクション ロボット',
    '工場 AI セキュリティ',
    'ヒューマノイド 安全基準',
  ],
  sections: [
    {
      id: 'why-now',
      heading: 'なぜ今問題になっているのか',
      body: [
        '三つの流れが重なっています。生成AIへの期待が製造・ロボット領域に移ってきたこと、ヒューマノイドの量産計画が具体化してきたこと、そしてロボットの判断部分にLLMが載り始めたことです。',
        '期待が先に立つ時期は、安全側の検討が後回しになりやすい時期でもあります。導入の判断材料として、まず現場で何が起きうるかを押さえておく価値があります。',
      ],
      articles: [
        'yaskawa-ai-robot-factory-physical-ai',
        'gartner-hype-cycle-2026-physical-ai-peak',
        'tesla-optimus-10m-units-texas-gigafactory',
      ],
    },
    {
      id: 'threats',
      heading: '脅威の全体像：5つの入口',
      body: [
        '攻撃や事故の入口は、おおまかに5つに分けて考えると漏れが少なくなります。どれも単独で致命的になるというより、組み合わさったときに物理的な動作まで届きます。',
      ],
      sections: [
        {
          id: 'threat-prompt-injection',
          heading: '1. プロンプトインジェクション・指示の乗っ取り',
          body: [
            'LLMは、与えられたテキストを命令と区別しません。作業指示書、ラベル、チャット、カメラが読み取った文字列など、外から入ってくるものはすべて命令になりうると考える必要があります。',
            '対策の起点は、信頼できる入力と信頼できない入力の境界をどこに引くかを決めることです。',
          ],
          articles: ['llm-prompt-injection-trust-boundary-minimum-implementation'],
        },
        {
          id: 'threat-credentials',
          heading: '2. 認証情報・APIキーの漏洩',
          body: [
            'エージェントが外部サービスやロボットの制御APIを叩く構成では、鍵の持ち方がそのまま権限の大きさになります。コード生成の過程で鍵が露出する経路も現実にあります。',
            '権限は用途ごとに分け、有効期限を切り、どの鍵がどの操作に使われたかを後から追える形にしておきます。',
          ],
          articles: ['ai-agent-api-key-security-credential-management'],
        },
        {
          id: 'threat-sensors',
          heading: '3. センサーや学習データへの改ざん',
          body: [
            'カメラや距離センサーの入力が操作されれば、モデルは正しく動いたまま誤った判断に至ります。学習・微調整に使うデータの汚染も同じ結果を招きます。',
            '入力の妥当性チェックと、データの出どころを記録しておくことが前提になります。',
          ],
        },
        {
          id: 'threat-edge',
          heading: '4. エッジ端末・IoTの脆弱性',
          body: [
            '現場の推論はエッジ側で動くことが多く、そこは従来からIoT機器として狙われてきた層です。更新しづらい機器が長く残る点も、工場特有の弱さです。',
          ],
          articles: [
            'anthropic-self-replicating-ai-iot-security',
            'advantech-physical-ai-edge-japan-manufacturing-strategy',
          ],
        },
        {
          id: 'threat-supply-chain',
          heading: '5. サプライチェーン（部品・基盤モデルの依存）',
          body: [
            '部品と基盤モデルの両方で、調達先が絞られている状況です。供給が止まるリスクと、依存先の変更が安全性の前提を崩すリスクの二つがあります。',
          ],
          articles: [
            'us-robot-import-ban-china-dependency-contradiction',
            'china-physical-ai-15-companies-ecosystem-structure',
          ],
        },
      ],
    },
    {
      id: 'safety-design',
      heading: '安全設計の考え方：AIの外側に決定論的な監視層を置く',
      body: [
        '設計の軸は一つです。AIの判断を信頼するのではなく、AIの外側に、AIの出力を検査して止められる決定論的な層を置くことです。速度・可動域・力・人の接近といった条件は、モデルの推論ではなく明示的なルールで判定します。',
        'この層はAIより単純で、だからこそ検証できます。モデルを差し替えても安全の前提が崩れないという意味でも、この分離は効きます。',
      ],
      articles: [
        'physical-ai-safety-deterministic-supervisor',
        'physical-ai-robotics-safety-design-shift',
        'nvidia-halos-physical-ai-safety-full-stack',
      ],
    },
    {
      id: 'verification',
      heading: '検証の方法：レッドチーミングとシミュレーション',
      body: [
        '仕様どおり動くかのテストと、悪意ある入力に耐えるかの検証は別の作業です。後者はレッドチーミングとして、攻撃側の発想で指示や入力を作って試す必要があります。',
        '物理的に危険な条件はシミュレーションで数を稼ぎ、実機では範囲を絞って確認する、という組み合わせが現実的です。',
      ],
      articles: [
        'laplace-intelligence-red-teaming-physical-ai-safety',
        'nvidia-cosmos-3-physical-ai-siggraph-2026',
      ],
    },
    {
      id: 'standards',
      heading: '規格・フレームワークの現状',
      body: [
        '機械の機能安全と、AIの振る舞いの評価は、まだきれいにつながっていません。従来の機能安全の枠組みは決定論的な制御を前提にしており、確率的に出力が変わるモデルをそのまま当てはめにくいためです。',
        '実務では、安全要件は従来の枠組みで満たし、AIはその枠組みの内側で動かす構成を取るのが無理のない解になります。適用する規格の名称と版、そして認証の範囲は、導入時点の一次情報で必ず確認してください。',
      ],
      articles: [
        'mipi-alliance-humanoid-physical-ai-interface-standard',
        'medical-ai-compliance-llm-samd-guide',
      ],
    },
    {
      id: 'japan-cases',
      heading: '国内企業の取り組み事例',
      body: [
        '国内でも、現場の安全確認にAIを使う例と、ロボット側の知能をAIで置き換える例の両方が出てきています。環境条件が厳しい現場ほど、監視層の設計が具体的に語られる傾向があります。',
      ],
      articles: [
        'ai-camera-factory-safety-rengou-kirin',
        'hitachi-anthropic-physical-ai-strategy',
        'physical-ai-robot-decommissioning-fukushima-development',
      ],
    },
  ],
  checklist: {
    heading: '導入前チェックリスト',
    intro: 'ベンダー選定と社内レビューでそのまま使える形にしています。',
    items: [
      'AIの出力を検査して停止させる層が、AIの外側に独立して存在するか',
      '非常停止と速度・可動域・力の制限が、モデルの推論を介さずに効くか',
      '信頼できない入力（作業指示、ラベル、外部データ、カメラが読む文字）の境界が決まっているか',
      'ロボット制御APIの権限が用途ごとに分かれ、鍵に有効期限があるか',
      '誰が・どの鍵で・どの操作をしたかを後から追えるログが残るか',
      'センサー入力の妥当性チェック（範囲・連続性・冗長系との突き合わせ）があるか',
      '学習・微調整に使ったデータの出どころを記録しているか',
      'エッジ機器のファームウェア更新手順と、更新できない機器の洗い出しが済んでいるか',
      '悪意ある指示を想定したレッドチーミングを、受け入れ前に実施したか',
      '基盤モデルや主要部品の供給が止まった場合の代替案を持っているか',
    ],
  },
  freshness: {
    domain: [
      'ロボット',
      'ロボティクス',
      'ヒューマノイド',
      'フィジカルAI',
      'Physical AI',
      '工場',
      '製造',
      'エッジ',
      '自動運転',
      '産業',
    ],
    aspect: [
      'セキュリティ',
      '安全',
      'リスク',
      '脆弱',
      'インジェクション',
      '漏洩',
      '事故',
      '規格',
      '認証',
    ],
  },
  seeAlso: [
    {
      href: '/incidents',
      label: '国内AIインシデント一覧',
      description: '国内で報じられたAI関連のインシデントを、一次情報つきで時系列に並べた一覧。',
    },
  ],
};

export const GUIDES: Guide[] = [PHYSICAL_AI_SECURITY];

export function getGuide(slug: string | undefined): Guide | null {
  if (!slug) return null;
  return GUIDES.find(guide => guide.slug === slug) ?? null;
}

/** Flattens a guide's sections, nesting included, in reading order. */
export function flattenSections(guide: Guide): GuideSection[] {
  return guide.sections.flatMap(section => [section, ...(section.sections ?? [])]);
}

export function guideArticleSlugs(guide: Guide): string[] {
  return Array.from(
    new Set(flattenSections(guide).flatMap(section => section.articles ?? [])),
  );
}

/**
 * The reverse link: given an article, the guide that links to it and the
 * section it was mapped to. First match wins (an article belongs to one
 * heading by design).
 */
export function findGuideForArticle(
  articleSlug: string,
): { guide: Guide; section: GuideSection } | null {
  for (const guide of GUIDES) {
    for (const section of flattenSections(guide)) {
      if (section.articles?.includes(articleSlug)) {
        return { guide, section };
      }
    }
  }
  return null;
}
