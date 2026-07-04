// One-off: backdate-publish the top-N scored articles from the scoring outage window.
// Dry run (default): prints the selection. Execute: node scripts/backfill-past-articles.mjs --execute [--limit=N]

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const getEnv = (k) => (env.match(new RegExp('^' + k + '\\s*=\\s*"?([^"\\n]+)"?', 'm')) || [])[1]?.trim();

const SUPABASE_URL = getEnv('SUPABASE_URL');
const SERVICE_KEY = getEnv('SUPABASE_SERVICE_ROLE_KEY');
const CRON_SECRET = getEnv('CRON_SECRET');
const SITE = 'https://www.aiojisan.com';

const WINDOW_LO = '2026-06-21T00:00:00Z';
const WINDOW_HI = '2026-07-02T23:59:59Z';
const TOP_N = 20;

const execute = process.argv.includes('--execute');
const limitArg = (process.argv.find((a) => a.startsWith('--limit=')) || '').split('=')[1];
const limit = limitArg ? Number(limitArg) : null;

const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const { data, error } = await db
  .from('articles')
  .select('id, title, published_at, fetched_at, article_ai_insights!inner(overall_score)')
  .gte('fetched_at', WINDOW_LO)
  .lte('fetched_at', WINDOW_HI)
  .limit(3000);

if (error) {
  console.error('Query failed:', error.message);
  process.exit(1);
}

const rows = (data || [])
  .map((a) => {
    const ins = Array.isArray(a.article_ai_insights) ? a.article_ai_insights[0] : a.article_ai_insights;
    return { id: a.id, score: ins?.overall_score, backdate: a.published_at ?? a.fetched_at, title: a.title || '' };
  })
  .filter((r) => r.score != null)
  .sort((a, b) => b.score - a.score)
  .slice(0, TOP_N);

const targets = limit ? rows.slice(0, limit) : rows;

console.log(`\nTop ${rows.length} scored articles in window (${execute ? 'EXECUTE' : 'DRY RUN'}${limit ? `, limit ${limit}` : ''}):\n`);
rows.forEach((r, i) => {
  const mark = i < targets.length ? '>' : ' ';
  console.log(`${mark} ${String(i + 1).padStart(2)}. score=${r.score}  ${String(r.backdate).slice(0, 10)}  ${r.title.slice(0, 60)}`);
});

if (!execute) {
  console.log('\n(dry run — nothing published. Re-run with --execute to publish, or --execute --limit=1 for a canary.)');
  process.exit(0);
}

console.log(`\nExecuting ${targets.length} backfill(s)...\n`);
let ok = 0;
let fail = 0;
for (const [i, r] of targets.entries()) {
  try {
    const res = await fetch(`${SITE}/api/admin/backfill-article`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON_SECRET}` },
      body: JSON.stringify({ article_id: r.id }),
    });
    const j = await res.json().catch(() => ({}));
    if (res.ok && j.ok) {
      ok++;
      console.log(`${i + 1}/${targets.length} OK  wpPostId=${j.wpPostId}${j.skipped ? ' (skipped: draft exists)' : ''}  | ${r.title.slice(0, 40)}`);
    } else {
      fail++;
      console.log(`${i + 1}/${targets.length} FAIL ${res.status} ${j.error || ''}  | ${r.title.slice(0, 40)}`);
    }
  } catch (e) {
    fail++;
    console.log(`${i + 1}/${targets.length} ERROR ${String(e)}  | ${r.title.slice(0, 40)}`);
  }
}
console.log(`\nDone. ok=${ok} fail=${fail}`);
