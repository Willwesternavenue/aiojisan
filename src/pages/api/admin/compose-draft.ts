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
  const newCategoryNameRaw = String(form.get('newCategoryName') ?? '').trim();
  const tagsRaw = String(form.get('tags') ?? '').trim();

  const categoryIds = form.getAll('categoryIds')
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0);

  // The full id→name map for every category rendered in the picker travels
  // through as a hidden field, so we can label the selected ones without an
  // extra WordPress round trip. Best-effort: a malformed/missing map just
  // means the dashboard label falls back to ids only.
  let categoryNames: string[] = [];
  try {
    const raw = String(form.get('categoryNamesJson') ?? '[]');
    const parsed = JSON.parse(raw) as { id: number; name: string }[];
    if (Array.isArray(parsed)) {
      const nameById = new Map(parsed.map((c) => [c.id, c.name]));
      categoryNames = categoryIds
        .map((id) => nameById.get(id))
        .filter((name): name is string => typeof name === 'string');
    }
  } catch (err) {
    logger.warn('Failed to parse categoryNamesJson, falling back to ids only', { err: String(err) });
  }

  if (!topic) {
    return context.redirect('/admin/compose?error=' + encodeURIComponent('トピックを入力してください'));
  }

  try {
    const result = await composeDraftForTopic({
      topic,
      angle: angleRaw || undefined,
      categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
      categoryNames: categoryNames.length > 0 ? categoryNames : undefined,
      newCategoryName: newCategoryNameRaw || undefined,
      tags: tagsRaw || undefined,
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
