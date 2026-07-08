// One-off: add the 4 verified overseas-AI-business RSS sources.
// Dry run (default): show what would be inserted. Execute: node scripts/add-overseas-sources.mjs --execute
// Idempotent: skips any source whose list_url already exists.

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const env = readFileSync(new URL('../.env', import.meta.url), 'utf8');
const getEnv = (k) => (env.match(new RegExp('^' + k + '\\s*=\\s*"?([^"\\n]+)"?', 'm')) || [])[1]?.trim();

const db = createClient(getEnv('SUPABASE_URL'), getEnv('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false },
});

// Feed URLs verified by direct fetch on 2026-07-08 (valid RSS/Atom XML).
const SOURCES = [
  {
    name: 'Crunchbase News',
    source_type: 'rss',
    base_url: 'https://news.crunchbase.com',
    list_url: 'https://news.crunchbase.com/feed/',
    priority: 6,
    tags: ['海外AIビジネス'],
    enabled: true,
  },
  {
    name: 'CB Insights Research',
    source_type: 'rss',
    base_url: 'https://www.cbinsights.com',
    list_url: 'https://www.cbinsights.com/research/feed/',
    priority: 6,
    tags: ['海外AIビジネス'],
    enabled: true,
  },
  {
    name: 'Sifted AI',
    source_type: 'rss',
    base_url: 'https://sifted.eu',
    list_url: 'https://sifted.eu/sector/artificial-intelligence/feed',
    priority: 5,
    tags: ['海外AIビジネス'],
    enabled: true,
  },
  {
    name: "Ben's Bites",
    source_type: 'rss',
    base_url: 'https://www.bensbites.com',
    list_url: 'https://www.bensbites.com/feed',
    priority: 5,
    tags: ['海外AIビジネス'],
    enabled: true,
  },
];

const execute = process.argv.includes('--execute');
let inserted = 0;
let skipped = 0;

for (const source of SOURCES) {
  const { data: existing, error: selErr } = await db
    .from('sources')
    .select('id')
    .eq('list_url', source.list_url)
    .limit(1)
    .maybeSingle();
  if (selErr) {
    console.error(`SELECT failed for ${source.name}: ${selErr.message}`);
    process.exit(1);
  }
  if (existing) {
    skipped++;
    console.log(`SKIP (exists): ${source.name}`);
    continue;
  }
  if (!execute) {
    console.log(`WOULD INSERT: ${source.name}  ${source.list_url}  priority=${source.priority}`);
    continue;
  }
  const { error: insErr } = await db.from('sources').insert(source);
  if (insErr) {
    console.error(`INSERT failed for ${source.name}: ${insErr.message}`);
    process.exit(1);
  }
  inserted++;
  console.log(`INSERTED: ${source.name}`);
}

console.log(
  execute
    ? `\nDone. inserted=${inserted} skipped=${skipped}`
    : `\n(dry run — nothing written. Re-run with --execute to insert.)`,
);
