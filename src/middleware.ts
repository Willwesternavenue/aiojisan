import { defineMiddleware } from 'astro:middleware';
import { createClient } from '@supabase/supabase-js';

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  // Only protect /admin/* routes (but not /admin/login itself)
  if (!pathname.startsWith('/admin') || pathname.startsWith('/admin/login')) {
    return next();
  }

  // Dev bypass: skip auth when running in development mode
  if (import.meta.env.DEV) {
    return next();
  }

  const supabaseUrl = import.meta.env.SUPABASE_URL;
  const supabaseAnonKey = import.meta.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return context.redirect('/admin/login');
  }

  const token = context.cookies.get('admin_session')?.value;
  if (!token) {
    return context.redirect('/admin/login');
  }

  try {
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      context.cookies.delete('admin_session', { path: '/' });
      return context.redirect('/admin/login');
    }
  } catch {
    context.cookies.delete('admin_session', { path: '/' });
    return context.redirect('/admin/login');
  }

  return next();
});
