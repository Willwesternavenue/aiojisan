// Gap backfill orchestrator: for each day, score a candidate pool then
// backdate-publish the top-N. Dry-run by default.
// node scripts/backfill-gap-days.mjs --day=2026-06-22 [--per-day=5] [--min-score=8.0] [--rounds=2] [--execute]
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const ge = (k) => (env.match(new RegExp('^' + k + '\\s*=\\s*"?([^"\\n]+?)"?\\s*$', 'm')) || [])[1];
const SUPABASE_URL = ge('SUPABASE_URL'), SERVICE_KEY = ge('SUPABASE_SERVICE_ROLE_KEY'), CRON = ge('CRON_SECRET');
const SITE = 'https://www.aiojisan.com';
const db = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const arg = (k, d) => { const a = process.argv.find(x => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
const execute = process.argv.includes('--execute');
const perDay = Number(arg('per-day', 5)), minScore = Number(arg('min-score', 8.0)), rounds = Number(arg('rounds', 2));
const days = arg('day') ? [arg('day')] : [];
if (arg('all')) { for (let d = 22; d <= 30; d++) days.push(`2026-06-${d}`); days.push('2026-07-01'); }

const post = (path, body) => fetch(`${SITE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${CRON}` }, body: JSON.stringify(body) }).then(r => r.json().catch(() => ({})));

for (const day of days) {
  const lo = `${day}T00:00:00Z`, hi = new Date(new Date(lo).getTime() + 86400000).toISOString();
  console.log(`\n=== ${day} (${execute ? 'EXECUTE' : 'DRY RUN'}) ===`);
  for (let r = 0; r < rounds; r++) {
    const res = await post('/api/admin/score-day', { day, limit: 15 });
    console.log(`  score round ${r + 1}: scored=${res.scored} failed=${res.failed} remaining=${res.remaining} candidates=${res.candidates}`);
    if (!res.scored) break;
  }
  // select top-N scored, not yet drafted, for the day
  const { data } = await db.from('articles')
    .select('id, title, published_at, fetched_at, article_ai_insights!inner(overall_score), article_actions(action_type), generated_drafts(id)')
    .gte('fetched_at', lo).lt('fetched_at', hi).limit(1000);
  const cand = (data || []).map(a => {
    const ins = Array.isArray(a.article_ai_insights) ? a.article_ai_insights[0] : a.article_ai_insights;
    const drafted = (Array.isArray(a.article_actions) ? a.article_actions : []).some(x => x.action_type === 'generate_blog_draft')
      || (Array.isArray(a.generated_drafts) ? a.generated_drafts.length > 0 : !!a.generated_drafts);
    return { id: a.id, title: a.title || '', score: Number(ins?.overall_score ?? 0), backdate: (a.published_at ?? a.fetched_at), drafted };
  }).filter(x => !x.drafted && x.score >= minScore).sort((a, b) => b.score - a.score).slice(0, perDay);

  console.log(`  → top ${cand.length} (score>=${minScore}):`);
  cand.forEach((c, i) => console.log(`     ${i + 1}. score=${c.score}  ${String(c.backdate).slice(0, 10)}  ${c.title.slice(0, 55)}`));

  if (execute) {
    for (const c of cand) {
      const j = await post('/api/admin/backfill-article', { article_id: c.id });
      console.log(`     ${j.ok ? 'OK  wp=' + j.wpPostId : 'FAIL ' + (j.error || '')}  | ${c.title.slice(0, 40)}`);
    }
  }
}
console.log('\nDONE');
