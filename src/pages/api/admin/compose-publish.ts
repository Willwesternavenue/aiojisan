// API: publish a composed draft on ichikarablog (no WordPress login needed).

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/auth';
import { publishComposedDraft } from '@/services/drafts/compose';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:compose-publish');

export const POST: APIRoute = async (context) => {
  const authError = await requireAdminSession(context);
  if (authError) return authError;

  const form = await context.request.formData();
  const id = String(form.get('id') ?? '').trim();

  if (!id) {
    return context.redirect('/admin/compose?error=' + encodeURIComponent('公開する下書きが指定されていません'));
  }

  try {
    const { link } = await publishComposedDraft(id);
    const params = new URLSearchParams({ published: '1' });
    if (link) params.set('link', link);
    return context.redirect('/admin/compose?' + params.toString());
  } catch (err) {
    logger.error('Publish failed', { id, err: String(err) });
    return context.redirect(
      '/admin/compose?error=' + encodeURIComponent('公開処理中にエラーが発生しました'),
    );
  }
};
