// API: Manually trigger ingestion for a single source

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/auth';
import { getAdminClient } from '@/lib/supabase/server';
import { runSourceIngestion } from '@/services/ingestion/pipeline';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:sources-run');

export const POST: APIRoute = async (context) => {
  const authError = await requireAdminSession(context);
  if (authError) return authError;

  const { request, redirect } = context;
  const formData = await request.formData();
  const sourceId = formData.get('source_id') as string;

  if (!sourceId) return new Response('Missing source_id', { status: 400 });

  const db = getAdminClient();
  const { data: source, error } = await db
    .from('sources')
    .select('*')
    .eq('id', sourceId)
    .single();

  if (error || !source) return new Response('Source not found', { status: 404 });

  logger.info('Manual source run triggered', { sourceId, name: source.name });

  // Run in background-ish manner — respond immediately, run async
  // In a real deployment, this would be a background job
  runSourceIngestion(source).catch(err => {
    logger.error('Manual source run failed', { sourceId, err: String(err) });
  });

  return redirect('/admin/sources');
};
