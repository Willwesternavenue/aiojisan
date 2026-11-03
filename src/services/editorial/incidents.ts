/**
 * 国内AIインシデント一覧のデータ。
 *
 * 掲載基準（この4つをすべて満たすものだけを載せる）:
 *   1. 国内の組織・サービスが関係している。
 *   2. AIの利用または提供が原因の一部になっている。
 *   3. 一次情報で確認できる（当該組織の発表、行政・委員会の公表、当事者の報告書）。
 *      報道だけで当事者の確認が取れていないものは載せない。
 *   4. 事実として書ける範囲が確定している（推測や評価は書かない）。
 *
 * 1件追加するときの手順は docs/editorial/ai-incidents-operations.md を参照。
 */

export type IncidentCategorySlug =
  | 'data-leak'
  | 'faulty-output'
  | 'prompt-injection'
  | 'credentials'
  | 'physical-safety'
  | 'compliance'
  | 'outage';

export type IncidentCategory = {
  slug: IncidentCategorySlug;
  label: string;
  description: string;
};

export const INCIDENT_CATEGORIES: IncidentCategory[] = [
  {
    slug: 'data-leak',
    label: '情報漏洩',
    description: '入力した情報や学習データが意図せず外部・他ユーザーに出た事例',
  },
  {
    slug: 'faulty-output',
    label: '誤出力・誤判定',
    description: 'AIの出力の誤りがそのまま業務や利用者への不利益になった事例',
  },
  {
    slug: 'prompt-injection',
    label: '不正利用・指示の乗っ取り',
    description: 'プロンプトインジェクションや悪用により想定外の動作をした事例',
  },
  {
    slug: 'credentials',
    label: '認証情報・権限',
    description: 'APIキーやアクセス権限の扱いが原因になった事例',
  },
  {
    slug: 'physical-safety',
    label: '物理的な安全',
    description: 'ロボット・車両・設備など、物理的な動作に関わる事故や危険',
  },
  {
    slug: 'compliance',
    label: '権利・コンプライアンス',
    description: '著作権、個人情報、景表法など法令・権利の面で問題になった事例',
  },
  {
    slug: 'outage',
    label: '停止・障害',
    description: 'AIサービスの停止や性能劣化が業務に影響した事例',
  },
];

export type IncidentStatus = 'investigating' | 'responding' | 'resolved';

export const INCIDENT_STATUS_LABELS: Record<IncidentStatus, string> = {
  investigating: '調査中',
  responding: '対応中',
  resolved: '収束',
};

export type IncidentSource = {
  /** 一次情報のページタイトル（原文のまま）。 */
  title: string;
  /** 発表元（組織名）。 */
  publisher: string;
  url: string;
  /** そのURLを確認した日（YYYY-MM-DD）。 */
  retrievedOn: string;
};

export type AiIncident = {
  /** `YYYY-MM-組織-短いキーワード` の形式。一度決めたら変えない。 */
  id: string;
  /** 公表日（YYYY-MM-DD）。並び順はこの日付。 */
  reportedOn: string;
  /** 発生日が公表されている場合のみ。 */
  occurredOn?: string;
  /** 組織・サービス名。 */
  organization: string;
  /** 業種や領域（製造、金融、自治体など）。 */
  sector?: string;
  category: IncidentCategorySlug;
  /** 何が起きたか。一次情報に書かれている事実だけを2〜3文で。 */
  summary: string;
  /** 影響範囲（件数・期間など、公表されている数字のみ）。 */
  impact?: string;
  /** 当該組織が公表した対応。 */
  response?: string;
  status: IncidentStatus;
  /** 最低1件。一次情報がなければ掲載しない。 */
  sources: IncidentSource[];
  /** このサイト内の関連記事（WordPressのスラッグ）。 */
  relatedArticles?: string[];
};

/**
 * 記入例（この形で1件ずつ追加する。値はすべて一次情報から転記する）:
 *
 * {
 *   id: '2026-10-example-corp-support-bot-leak',
 *   reportedOn: '2026-10-15',
 *   occurredOn: '2026-10-02',
 *   organization: '株式会社サンプル（サポートチャット）',
 *   sector: '小売',
 *   category: 'data-leak',
 *   summary:
 *     'サポート用チャットボットの応答に、別の利用者が入力した問い合わせ内容が含まれていた。' +
 *     '同社は原因をセッション管理の不備と公表した。',
 *   impact: '対象は同期間の利用者◯◯件（同社発表）。',
 *   response: '該当機能を停止し、対象利用者へ個別に連絡。再発防止策を公表。',
 *   status: 'resolved',
 *   sources: [
 *     {
 *       title: '当社サポートチャットにおける事象について',
 *       publisher: '株式会社サンプル',
 *       url: 'https://example.com/news/2026/10/15/',
 *       retrievedOn: '2026-10-16',
 *     },
 *   ],
 *   relatedArticles: [],
 * },
 */
export const AI_INCIDENTS: AiIncident[] = [];

/** 一覧を公表できる状態か（1件も確認できていないうちは公開しない）。 */
export const isIncidentListPublished = (): boolean => AI_INCIDENTS.length > 0;

export function sortedIncidents(incidents: AiIncident[] = AI_INCIDENTS): AiIncident[] {
  return [...incidents].sort((a, b) => b.reportedOn.localeCompare(a.reportedOn));
}

export function getIncidentCategory(slug: IncidentCategorySlug): IncidentCategory {
  return INCIDENT_CATEGORIES.find(category => category.slug === slug) ?? INCIDENT_CATEGORIES[0];
}

export function incidentCountsByCategory(
  incidents: AiIncident[] = AI_INCIDENTS,
): Array<IncidentCategory & { count: number }> {
  return INCIDENT_CATEGORIES.map(category => ({
    ...category,
    count: incidents.filter(incident => incident.category === category.slug).length,
  }));
}

/** 最後に1件追加・更新された日。空のときは null。 */
export function latestIncidentDate(incidents: AiIncident[] = AI_INCIDENTS): string | null {
  return sortedIncidents(incidents)[0]?.reportedOn ?? null;
}
