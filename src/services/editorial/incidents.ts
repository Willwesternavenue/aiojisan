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
  | 'ai-vulnerability'
  | 'credentials'
  | 'impersonation'
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
    description:
      'プロンプトインジェクションや悪用により想定外の動作をした事例と、攻撃側がAIツールを使った事例',
  },
  {
    slug: 'ai-vulnerability',
    label: 'AI機能の脆弱性',
    description: 'AIアシスタントなどAI機能そのものの実装不備が原因になった事例',
  },
  {
    slug: 'credentials',
    label: '認証情報・権限',
    description: 'APIキーやアクセス権限の扱いが原因になった事例',
  },
  {
    slug: 'impersonation',
    label: 'なりすまし・合成コンテンツ',
    description: '第三者が生成AIで作った偽の動画・音声・画像により、組織や個人が被害を受けた事例',
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
 * 掲載基準を満たした事例のみ。新しい順（並び替えは sortedIncidents が行うので、
 * ここでの並びは読みやすさのため）。1件追加する手順は
 * docs/editorial/ai-incidents-operations.md を参照。
 */
export const AI_INCIDENTS: AiIncident[] = [
  {
    id: '2026-10-panasonic-oe-genai-upload',
    reportedOn: '2026-10-23',
    organization: 'パナソニック オペレーショナルエクセレンス株式会社',
    sector: '製造',
    category: 'data-leak',
    summary:
      '人事情報システム導入プロジェクトのメンバーが、社内で利用を禁止している外部の生成AIサービスに、' +
      '2026年4月時点の人事情報システムに登録されていた個人情報を含むデータをアップロードした。' +
      '同社は、外部からの不正な操作ではなくメンバーによるルール違反だと公表している。',
    impact:
      '従業員約7万5千人、元従業員約17万8千人、従業員の家族約5万5千人、元従業員の家族約2万6千人（同社発表）。' +
      '従業員・元従業員は社員番号・住所・電話番号・メールアドレスで、氏名は含まない。',
    response:
      '発覚直後にチャット履歴と業務用PC内のデータを削除。2026年9月29日に個人情報保護委員会へ報告した。' +
      'サービス提供元からは、学習に利用する機能が無効だったことと、削除から30日が経過した10月25日以降は' +
      '事業者内でもデータを保持していないことの回答を得たとしている。',
    status: 'responding',
    sources: [
      {
        title: '外部生成AIサービスへの個人情報アップロードに関するお詫びとお知らせ',
        publisher: 'パナソニック オペレーショナルエクセレンス株式会社',
        url: 'https://holdings.panasonic/jp/information/topics/20261023.html',
        retrievedOn: '2026-11-03',
      },
    ],
  },
  {
    id: '2026-10-jpcert-ai-pentest-tool-abuse',
    reportedOn: '2026-10-23',
    organization: '国内の複数組織（JPCERT/CCが注意喚起）',
    sector: '横断',
    category: 'prompt-injection',
    summary:
      'JPCERT/CCは、CairnやCyberStrikeAI、ARTEXなどのAIを用いたペネトレーションテスト基盤を悪用した' +
      '攻撃試行を確認したと公表した。主にインターネットに公開されたWebアプリケーションを標的に、' +
      'さまざまな脆弱性の探索・悪用や、機器の管理不備を突いた攻撃（環境設定ファイルやバックアップファイルの窃取など）' +
      'が試みられている。インターネットに公開されたWSUSサーバーを標的とした攻撃試行も含まれる。',
    impact:
      '不審な送信元IPアドレス9件を観測日付つきで公表（調査時点では正規に利用されている可能性もあるとしている）。' +
      '被害組織名は公表されていない。',
    response: '注意喚起は2026年10月8日公開。このケースEは10月23日の更新で追加された。',
    status: 'investigating',
    sources: [
      {
        title: '直近で相次いでいる国内組織における不正アクセスに関する注意喚起（JPCERT-AT-2026-0030）',
        publisher: 'JPCERT/CC',
        url: 'https://www.jpcert.or.jp/at/2026/at260030.html',
        retrievedOn: '2026-11-03',
      },
    ],
  },
  {
    id: '2026-10-osaka-sano-hs-fax-misdirection',
    reportedOn: '2026-10-23',
    occurredOn: '2026-05-15',
    organization: '大阪府立佐野高等学校（大阪府教育庁）',
    sector: '教育・自治体',
    category: 'faulty-output',
    summary:
      '教員が大阪府高等学校野球連盟への報告書をFAXで送る際、AI検索で表示されたFAX番号に送信し、' +
      '誤った宛先に届いた。大阪府は原因を、AI検索の情報を鵜呑みにしたうえ、' +
      'あらかじめテスト送信などを行って番号を確認することを怠ったためと公表している。',
    impact: '生徒6名分の氏名・学年・報告内容（大阪府発表）。',
    response:
      '誤送信先に連絡して報告書を廃棄してもらい、生徒と保護者に個別・直接の説明と謝罪を実施。' +
      '校内研修の実施、個人情報を外部へ送信する際の管理職の許可、初めての送信先へのテスト送信と' +
      '複数人での番号確認を徹底し、教育庁が全府立学校に注意喚起を行うとしている。',
    status: 'resolved',
    sources: [
      {
        title: '個人情報が記載された書類の誤送信について',
        publisher: '大阪府（教育庁 教育振興室保健体育課）',
        url: 'https://www.pref.osaka.lg.jp/hodo/fumin/o180070/prs_50751.html',
        retrievedOn: '2026-11-03',
      },
    ],
  },
  {
    id: '2026-09-rizap-genai-upload',
    reportedOn: '2026-09-03',
    organization: 'RIZAP株式会社（特定保健指導の委託先）',
    sector: 'ヘルスケア',
    category: 'data-leak',
    summary:
      '健康経営・保険者事業部の社員が、特定保健指導管理システムのデータ集計作業中に、' +
      '個人で使用している外部の生成AIサービスへ対象データを誤ってアップロードした。' +
      '委託元の地方職員共済組合によると、2026年8月20日に発覚した。',
    impact:
      '対象は2026年1月1日〜8月19日に同システムに登録された特定保健指導対象者データの一部で、' +
      '保険証記号番号・氏名・生年月日・性別・メールアドレスなどと、一部の人の疾患情報' +
      '（高血圧症・糖尿病・脂質異常症）を含む（同社発表）。地方職員共済組合の対象者は14支部726名（同組合発表）。',
    response:
      '発生直後に該当チャット履歴を削除し、学習データの利用停止を設定。個人情報保護委員会への報告は完了。' +
      '学習に利用された可能性はないとしている。サービス提供元の役職員が閲覧可能な状態にあった可能性は確認中。',
    status: 'investigating',
    sources: [
      {
        title: '当社における外部生成AIサービスへのお客様情報の誤ったアップロードに関するお詫びとお知らせ',
        publisher: 'RIZAP株式会社',
        url: 'https://business.rizap.jp/news/2492',
        retrievedOn: '2026-11-03',
      },
      {
        title: '委託先における個人情報漏えいの可能性のある事案の発生について',
        publisher: '地方職員共済組合',
        url: 'https://www.chikyosai.or.jp/info/pdf/info_260904.pdf',
        retrievedOn: '2026-11-03',
      },
    ],
  },
  {
    id: '2026-08-komatsu-autonomous-bus-curb-2',
    reportedOn: '2026-08-18',
    occurredOn: '2026-08-18',
    organization: '小松市（小松空港〜小松駅の自動運転バス）',
    sector: '交通・自治体',
    category: 'physical-safety',
    summary:
      'レベル2で自動運転中の路線バスが、小松駅西口バスロータリーの入口付近で車体左側下部を縁石に接触させた。' +
      '市は原因を調査中とし、5月13日の接触事故との関連も不明としている。',
    impact: '乗客11人を含め、けが人なし（市発表）。',
    response:
      '自動運転を一時停止し、代替車両で運行を継続。市と事業者（BOLDLY、ティアフォー、北鉄加賀バス）が' +
      '走行データや車両の状態を調査している。',
    status: 'investigating',
    sources: [
      {
        title: '自動運転バスの縁石との接触事故の発生と今後の対応について',
        publisher: '小松市',
        url: 'https://www.city.komatsu.lg.jp/material/files/group/71/20260818_jiko.pdf',
        retrievedOn: '2026-11-03',
      },
      {
        title: '令和8年8月 小松市長定例記者会見 次第',
        publisher: '小松市',
        url: 'https://www.city.komatsu.lg.jp/material/files/group/6/20260821_02kaiken.pdf',
        retrievedOn: '2026-11-03',
      },
    ],
  },
  {
    id: '2026-08-shueisha-photobook-ai-altered-images',
    reportedOn: '2026-08-06',
    organization: '株式会社集英社（写真集『果実の歩幅』公式X）',
    sector: '出版',
    category: 'compliance',
    summary:
      '同社が発行した写真集について、掲載画像の転載・共有・販売や、生成AIなどを用いて加工・生成した画像の' +
      '投稿・共有・販売がSNS上で複数確認されたとして、写真集の公式Xで集英社名義の声明を出した。' +
      '画像・誌面は著作権法等で保護され、無断の加工・公開は肖像権等の侵害のおそれがあるとして、該当投稿の削除を求めている。',
    response: '無断の転載・販売等が確認された場合は、削除要請をはじめ、必要に応じて法的措置を含む対応を検討するとした。',
    status: 'responding',
    sources: [
      {
        title: '日向坂46藤嶌果歩1st写真集『果実の歩幅』を応援していただき、誠にありがとうございます。',
        publisher: '株式会社集英社（写真集公式アカウント @kahorin1st）',
        url: 'https://x.com/kahorin1st',
        retrievedOn: '2026-11-03',
      },
    ],
  },
  {
    id: '2026-05-komatsu-autonomous-bus-curb',
    reportedOn: '2026-05-14',
    occurredOn: '2026-05-13',
    organization: '小松市（小松空港〜小松駅の自動運転バス）',
    sector: '交通・自治体',
    category: 'physical-safety',
    summary:
      'レベル2で自動運転中の路線バスが、小松駅西口バスロータリーで車体左前方を縁石に接触させた。' +
      '市は調査の結果、自動運転時にのみ使う操舵システムの不具合が原因だったと公表した。',
    impact: '乗客なし、けが人なし。車体と縁石に擦り傷（市発表）。',
    response:
      '不具合のあった操舵システムを交換し、自己診断による監視と、設定レーン内に収める経路制御を追加。' +
      '2026年7月29日に手動運転、8月4日に自動運転を再開した。',
    status: 'resolved',
    sources: [
      {
        title: '自動運転バスの縁石との接触事故の発生と今後の対応について',
        publisher: '小松市',
        url: 'https://www.city.komatsu.lg.jp/material/files/group/71/komatsu_jiko_20260514.pdf',
        retrievedOn: '2026-11-03',
      },
      {
        title: '自動運転バスの縁石との接触事故の調査結果及び運行再開について',
        publisher: '小松市',
        url: 'https://www.city.komatsu.lg.jp/material/files/group/71/komatsu_jiko_20260728.pdf',
        retrievedOn: '2026-11-03',
      },
    ],
    relatedArticles: ['physical-ai-safety-deterministic-supervisor'],
  },
  {
    id: '2026-05-utena-ai-ad-similarity',
    reportedOn: '2026-05-06',
    organization: '株式会社ウテナ',
    sector: '化粧品',
    category: 'compliance',
    summary:
      '4月27日からの交通広告と5月1日公開のPR動画「潤い戦士モイスチャー」について、生成AIを用いた広告制作や、' +
      '特定の既存作品との類似性に多くの意見が寄せられた。同社は、既存の創作物の独自性やファンの心情への配慮が' +
      '不足していたとして謝罪した。',
    response:
      '公式YouTubeの該当動画と関連するSNS投稿を削除し、交通広告を順次撤去。外部専門家のリーガルチェックを経て' +
      '公開していたが、第三者の指導を受けて法規制上の問題がないかを改めて確認し、表現に対するチェック体制を' +
      '全面的に見直すとした。',
    status: 'responding',
    sources: [
      {
        title:
          '弊社スキンケアブランド「ウテナ モイスチャー」の交通広告およびPR動画『潤い戦士モイスチャー』について、' +
          'お詫びとご報告を申し上げます。',
        publisher: '株式会社ウテナ（公式アカウント @utena_official）',
        url: 'https://x.com/utena_official/status/2051844399538307301',
        retrievedOn: '2026-11-03',
      },
    ],
  },
  {
    id: '2026-02-tokyo-shinkiba-autonomous-shuttle',
    reportedOn: '2026-02-27',
    occurredOn: '2026-02-27',
    organization: '東京都港湾局（海の森公園〜新木場駅のシャトルバス）',
    sector: '交通・自治体',
    category: 'physical-safety',
    summary:
      'レベル2の自動運転機能を搭載したシャトルバスが、手動運転から自動運転に切り替えた際に、' +
      '中央分離帯の縁石に右前輪を接触させた。都は、車線変更処理が止まったまま経路から外れ、' +
      'その逸脱を検知できず、自動運転への復帰時に衝突回避も働かなかったと公表している。',
    impact: '乗客2人と運転手にけがなし。他の交通への影響なし（都発表）。',
    response:
      '車線変更処理のリセット機能、経路逸脱の検知精度の改善、衝突回避機能の改善を実施し、都のガイドラインにも反映。' +
      '運行事業者を変更して2026年9月19日に自動運転での運行を再開した。',
    status: 'resolved',
    sources: [
      {
        title: 'シャトルバス（自動運転機能レベル2搭載）の接触事故の発生について',
        publisher: '東京都',
        url: 'https://www.metro.tokyo.lg.jp/information/press/2026/03/2026030203',
        retrievedOn: '2026-11-03',
      },
      {
        title: 'シャトルバス（自動運転機能レベル2搭載）の接触事故について',
        publisher: '東京都',
        url: 'https://www.metro.tokyo.lg.jp/information/press/2026/03/2026033029',
        retrievedOn: '2026-11-03',
      },
      {
        title: '海の森公園と新木場駅を結ぶルートで自動運転バスを再開します',
        publisher: '東京都',
        url: 'https://www.metro.tokyo.lg.jp/information/press/2026/09/2026091715',
        retrievedOn: '2026-11-03',
      },
    ],
    relatedArticles: ['physical-ai-safety-deterministic-supervisor'],
  },
  {
    id: '2026-03-growi-ai-assistant-authz',
    reportedOn: '2026-03-16',
    organization: '株式会社GROWI（社内Wiki「GROWI」）',
    sector: 'ソフトウェア',
    category: 'ai-vulnerability',
    summary:
      'GROWI v7.4.5およびそれ以前のバージョンで、AIアシスタント機能のOpenAIスレッド・メッセージ APIに' +
      '権限チェックの欠如（CWE-862、CVE-2026-25083）があった。共有AIアシスタントの識別子を把握している' +
      'ログイン済みの利用者が、他の利用者のAIアシスタントのスレッド・メッセージを閲覧・改ざんできる可能性があった。',
    impact: 'CVSS v4基本値8.7、CVSS v3基本値8.3（JVN）。',
    response:
      'v7.4.6で修正。GMOサイバーセキュリティ by イエラエ株式会社の小田切祥氏が製品開発者に報告し、' +
      '調整を経てJVNで公表された。',
    status: 'resolved',
    sources: [
      {
        title: 'JVN#46373837 GROWIのOpenAIスレッド・メッセージ APIにおける権限チェック欠如の脆弱性',
        publisher: 'JPCERT/CC・IPA（JVN）',
        url: 'https://jvn.jp/jp/JVN46373837/',
        retrievedOn: '2026-11-03',
      },
    ],
  },
  {
    id: '2025-11-php-matsushita-deepfake',
    reportedOn: '2025-11-11',
    organization: '株式会社PHP研究所／パナソニック ホールディングス株式会社',
    sector: '出版・製造',
    category: 'impersonation',
    summary:
      '創業者・松下幸之助の画像や音声をAI技術により合成した動画が、YouTubeをはじめとするSNS上で' +
      '出回っていることが確認された。PHP研究所は、本人の名誉と遺族の感情を著しく損なうもので' +
      '違法な可能性が高いとし、パナソニックHDも、実際の発言等に基づかない誤った情報や、' +
      '肖像・発言の無断使用が含まれる場合があるとして注意を呼びかけている。',
    response:
      '継続的な監視と、発見次第の調査・記録、プラットフォームへの削除申立てや法的措置の検討。' +
      '閲覧・共有・転載をしないことと、SNSの「不正合成（deepfake）」「なりすまし」通報フォームからの' +
      '報告を呼びかけている。パナソニックHDは、PHP研究所と共同開発中の「『松下幸之助』再現AI」とは' +
      '無関係だと明記している。',
    status: 'responding',
    sources: [
      {
        title: '松下幸之助の偽造（AI合成）動画についての重要なお知らせ',
        publisher: '株式会社PHP研究所（松下幸之助.com）',
        url: 'https://konosuke-matsushita.com/news/media/20251111oshirase.php',
        retrievedOn: '2026-11-03',
      },
      {
        title: '創業者 松下幸之助のAI合成動画にご注意ください',
        publisher: 'パナソニック ホールディングス株式会社',
        url: 'https://holdings.panasonic/jp/information/topics/20251121.html',
        retrievedOn: '2026-11-03',
      },
    ],
  },
  {
    id: '2023-10-eiheiji-zen-drive-bicycle-contact',
    reportedOn: '2023-11-10',
    occurredOn: '2023-10-29',
    organization: 'まちづくり株式会社ZENコネクト／永平寺町（ZENドライブ）',
    sector: '公共交通・自治体',
    category: 'physical-safety',
    summary:
      'レベル4の自動運転車両が、対向車とのすれ違い待避所付近で、無人の駐輪自転車に車両左前のバンパーを接触させた。' +
      'ミリ波レーダと超音波センサは正常に検知していたが、この区間は誤検知を抑えるため前方カメラの画像認識と' +
      '合わせて自動ブレーキの制御判断を行う仕様で、無人の自転車を認識するための学習データが十分でなく、' +
      'カメラからは自転車の真後ろしか見えず認識面積が小さかったため、認識できなかった。',
    impact: 'けが人なし（乗客4名）。',
    response:
      '画像認識との整合がなくても接触の可能性がある物体を検知したら自動ブレーキをかけるよう制御判断を強化し、' +
      '検知の難しい向きを含む無人の自転車の画像を追加学習させた。注意喚起看板の増設などの運用面の措置も実施。',
    status: 'resolved',
    sources: [
      {
        title: 'テーマ１：【福井県永平寺町】遠隔監視のみ(レベル４)自動運転サービスの実現に向けた取り組み',
        publisher: 'RoAD to the L4プロジェクト成果報告会（経済産業省／産業技術総合研究所）',
        url: 'https://www.road-to-the-l4.go.jp/activity/theme01/pdf/20240228_theme01.pdf',
        retrievedOn: '2026-11-03',
      },
    ],
    relatedArticles: ['physical-ai-safety-deterministic-supervisor'],
  },
];

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
