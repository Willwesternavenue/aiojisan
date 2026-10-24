// API: operational digest for an external morning routine.
//
// The dashboard already surfaces alerts, but it needs a browser session and a
// human looking at it. This returns the same picture as JSON so a scheduled
// agent can read it alongside whatever else it reports on, and say something
// useful without being taught the schema.
//
// Auth: STATUS_TOKEN (read-only), or CRON_SECRET for manual checks.
// Bearer header or ?status_token= / ?cron_secret=.

import type { APIRoute } from 'astro';
import { requireStatusAuth } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase/server';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:status');

const ALERT_WINDOW_DAYS = 7;
const SILENT_SOURCE_DAYS = 3;
const PUBLISH_DROUGHT_WARN_HOURS = 30;

// Mirrors the dashboard labels so both surfaces say the same thing.
const ALERT_LABEL: Record<string, string> = {
  quota: 'AIクレジット枯渇',
  unrecorded_post: '記録なしの公開記事',
  image_failed: 'アイキャッチ生成失敗',
  category_failed: 'カテゴリ未付与',
  social_failed: 'X投稿失敗',
  source_failed: 'ソース取り込み失敗',
  research_failed: '下調べ失敗',
};

const ALERT_ACTION: Record<string, string> = {
  quota: '各プロバイダの残高を確認',
  unrecorded_post: 'WordPress側に記録のない記事あり。重複の恐れ',
  image_failed: '下書き履歴の「画像が無い記事に一括生成」で補完',
  category_failed: '記事が柱の一覧に出ません。WordPressでカテゴリを付与',
  social_failed: '記事は公開済みだが未投稿。必要なら手動投稿',
  source_failed: 'ソース管理でフィードURLと疎通を確認',
  research_failed: '出典なしで書かれています。公開前に内容を確認',
};

function hoursSince(iso: string | null | undefined): number | null {
  if (!iso) return null;
  return Math.round(((Date.now() - new Date(iso).getTime()) / 3_600_000) * 10) / 10;
}

function jstDayStart(daysAgo = 0): string {
  const jst = new Date(Date.now() + 9 * 3_600_000);
  jst.setUTCHours(0, 0, 0, 0);
  return new Date(jst.getTime() - 9 * 3_600_000 - daysAgo * 86_400_000).toISOString();
}

export const GET: APIRoute = async ({ request }) => {
  const authError = requireStatusAuth(request);
  if (authError) return authError;

  try {
    const db = getAdminClient();
    const alertWindow = new Date(Date.now() - ALERT_WINDOW_DAYS * 86_400_000).toISOString();
    const silentCutoff = new Date(Date.now() - SILENT_SOURCE_DAYS * 86_400_000).toISOString();
    const todayStart = jstDayStart();

    const [alertRes, lastPublishRes, todayPublishRes, articlesRes, scoredRes, sourcesRes] =
      await Promise.all([
        db
          .from('system_alerts')
          .select('kind, source, message, created_at')
          .gte('created_at', alertWindow)
          .order('created_at', { ascending: false }),
        db
          .from('generated_drafts')
          .select('created_at, draft_title, wordpress_post_id')
          .order('created_at', { ascending: false })
          .limit(1),
        db
          .from('generated_drafts')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', todayStart),
        db.from('articles').select('id', { count: 'exact', head: true }),
        db.from('article_ai_insights').select('id', { count: 'exact', head: true }),
        db.from('sources').select('id, name').eq('enabled', true),
      ]);

    // Alerts, grouped so the caller reports "3 image failures" rather than
    // three near-identical lines.
    const alertRows = alertRes.data ?? [];
    type KindSummary = { count: number; latest: string; samples: string[] };
    const byKind = new Map<string, KindSummary>();
    for (const row of alertRows) {
      const entry: KindSummary =
        byKind.get(row.kind) ?? { count: 0, latest: row.created_at, samples: [] };
      entry.count++;
      if (row.created_at > entry.latest) entry.latest = row.created_at;
      if (entry.samples.length < 3) entry.samples.push(row.message);
      byKind.set(row.kind, entry);
    }
    const alerts = [...byKind.entries()]
      .map(([kind, e]) => ({
        kind,
        label: ALERT_LABEL[kind] ?? kind,
        action: ALERT_ACTION[kind] ?? '内容を確認してください',
        count: e.count,
        latestAt: e.latest,
        samples: e.samples,
      }))
      .sort((a, b) => b.latestAt.localeCompare(a.latestAt));

    // Sources that have delivered nothing recently. A feed that simply has not
    // published is normal, so this is reported as "worth a look", not a fault.
    const sources = sourcesRes.data ?? [];
    const silentSources: string[] = [];
    await Promise.all(
      sources.map(async (s) => {
        const { count } = await db
          .from('articles')
          .select('id', { count: 'exact', head: true })
          .eq('source_id', s.id)
          .gte('fetched_at', silentCutoff);
        if ((count ?? 0) === 0) silentSources.push(s.name);
      }),
    );

    const lastPublish = lastPublishRes.data?.[0] ?? null;
    const publishDroughtHours = hoursSince(lastPublish?.created_at);
    const backlog = (articlesRes.count ?? 0) - (scoredRes.count ?? 0);

    const concerns: string[] = [];
    if (alerts.length > 0) {
      concerns.push(
        `アラート${alertRows.length}件（${alerts.map((a) => a.label).join('・')}）`,
      );
    }
    if (publishDroughtHours !== null && publishDroughtHours >= PUBLISH_DROUGHT_WARN_HOURS) {
      concerns.push(`公開が${publishDroughtHours}時間途切れています`);
    }
    if (silentSources.length > 0) {
      concerns.push(
        `${SILENT_SOURCE_DAYS}日間取り込みゼロのソース${silentSources.length}件（${silentSources.join('・')}）`,
      );
    }

    return new Response(
      JSON.stringify(
        {
          ok: true,
          checkedAt: new Date().toISOString(),
          healthy: concerns.length === 0,
          // A one-line summary the caller can quote directly.
          summary:
            concerns.length === 0
              ? '異常なし。パイプラインは正常に稼働しています。'
              : concerns.join(' / '),
          concerns,
          alerts,
          publishing: {
            lastPublishedAt: lastPublish?.created_at ?? null,
            hoursSinceLastPublish: publishDroughtHours,
            lastTitle: lastPublish?.draft_title ?? null,
            publishedToday: todayPublishRes.count ?? 0,
          },
          pipeline: {
            articles: articlesRes.count ?? 0,
            scored: scoredRes.count ?? 0,
            unscoredBacklog: backlog,
            enabledSources: sources.length,
            silentSources,
          },
        },
        null,
        2,
      ),
      { status: 200, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
    );
  } catch (err) {
    logger.error('Status digest failed', { err: String(err) });
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};
