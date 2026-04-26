// API: Update a source

import type { APIRoute } from 'astro';
import { getAdminClient } from '@/lib/supabase/server';
import { z } from 'zod';

const sourceSchema = z.object({
  name: z.string().min(1),
  source_type: z.enum(['rss', 'html', 'playwright']),
  base_url: z.string().url(),
  list_url: z.string().url(),
  priority: z.coerce.number().int().min(1).max(10).default(5),
  tags: z.string().optional(),
  enabled: z.string().optional(),
});

export const POST: APIRoute = async ({ params, request, redirect }) => {
  const sourceId = params.id;

  if (!sourceId) {
    return new Response('Missing source id', { status: 400 });
  }

  const formData = await request.formData();
  const raw = Object.fromEntries(formData.entries());

  const result = sourceSchema.safeParse(raw);
  if (!result.success) {
    return new Response(`Validation error: ${result.error.message}`, { status: 400 });
  }

  const data = result.data;
  const tags = data.tags
    ? data.tags.split(',').map(t => t.trim()).filter(Boolean)
    : [];

  const db = getAdminClient();
  const { error } = await db
    .from('sources')
    .update({
      name: data.name,
      source_type: data.source_type,
      base_url: data.base_url,
      list_url: data.list_url,
      priority: data.priority,
      tags,
      enabled: data.enabled === 'true',
    })
    .eq('id', sourceId);

  if (error) {
    console.error('[sources/update] Supabase error:', error);
    return new Response(`DB error: ${error.message}`, { status: 500 });
  }

  return redirect('/admin/sources');
};
