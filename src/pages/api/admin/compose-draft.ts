// API: compose a topic-directed draft on ichikarablog (draft only).

import type { APIRoute } from 'astro';
import { requireAdminSession } from '@/lib/auth';
import { composeDraftForTopic } from '@/services/drafts/compose';
import { createLogger } from '@/lib/logger';

const logger = createLogger('api:compose-draft');

export const POST: APIRoute = async (context) => {
  const authError = await requireAdminSession(context);
  if (authError) return authError;

  const form = await context.request.formData();
  const topic = String(form.get('topic') ?? '').trim();
  const angleRaw = String(form.get('angle') ?? '').trim();
  const categoryRaw = String(form.get('category') ?? '').trim();

  if (!topic) {
    return context.redirect('/admin/compose?error=' + encodeURIComponent('トピックを入力してください'));
  }

  try {
    const result = await composeDraftForTopic({
      topic,
      angle: angleRaw || undefined,
      categorySlug: categoryRaw || undefined,
    });

    if (result.status === 'failed') {
      return context.redirect(
        '/admin/compose?error=' + encodeURIComponent('下書きは生成しましたが、ichikarablogへの投稿に失敗しました'),
      );
    }

    return context.redirect('/admin/compose?composed=1');
  } catch (err) {
    logger.error('Compose failed', { err: String(err) });
    return context.redirect(
      '/admin/compose?error=' + encodeURIComponent('下書きの生成中にエラーが発生しました'),
    );
  }
};
