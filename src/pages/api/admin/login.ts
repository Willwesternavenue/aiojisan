// API: Admin login — validates credentials via Supabase Auth

import type { APIRoute } from 'astro';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseUrl, getSupabaseAnonKey } from '@/lib/env';

export const POST: APIRoute = async ({ request, cookies, redirect }) => {
  const formData = await request.formData();
  const email = formData.get('email') as string;
  const password = formData.get('password') as string;

  if (!email || !password) {
    return redirect('/admin/login?error=missing_fields');
  }

  const supabase = createClient(getSupabaseUrl(), getSupabaseAnonKey());
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });

  if (error || !data.session) {
    return redirect('/admin/login?error=invalid_credentials');
  }

  // Set session cookie
  cookies.set('admin_session', data.session.access_token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 7, // 7 days
    path: '/',
  });

  return redirect('/admin');
};
