// API: Record a manual editorial action (favorite, exclude, hold, etc.)

import type { APIRoute } from 'astro';
import { getAdminClient } from '@/lib/supabase/server';

export const POST: APIRoute = async ({ request, redirect }) => {
  const formData = await request.formData();
  const articleId = formData.get('article_id') as string;
  const actionType = formData.get('action_type') as string;
  const note = formData.get('note') as string | null;

  if (!articleId || !actionType) {
    return new Response('Missing fields', { status: 400 });
  }

  const db = getAdminClient();

  // Toggle-style actions: if already exists, remove it
  const toggleActions = ['favorite', 'exclude', 'hold'];
  if (toggleActions.includes(actionType)) {
    // Cast to any — Supabase types not generated yet
    const { count } = await (db as any)
      .from('article_actions')
      .select('id', { count: 'exact', head: true })
      .eq('article_id', articleId)
      .eq('action_type', actionType);

    if ((count ?? 0) > 0) {
      await db
        .from('article_actions')
        .delete()
        .eq('article_id', articleId)
        .eq('action_type', actionType);
    } else {
      await db.from('article_actions').insert({
        article_id: articleId,
        action_type: actionType,
        note: note ?? null,
      });
    }
  } else {
    // Non-toggle: always insert
    await db.from('article_actions').insert({
      article_id: articleId,
      action_type: actionType,
      note: note ?? null,
    });
  }

  return redirect(`/admin/feed/${articleId}`);
};
