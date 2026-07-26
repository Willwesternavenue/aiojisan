// API: Admin logout — clears the admin_session cookie.
//
// Must NOT require an admin session: someone with an invalid or expired
// session still needs to be able to log out.

import type { APIRoute } from 'astro';

export const POST: APIRoute = async ({ cookies, redirect }) => {
  cookies.delete('admin_session', { path: '/' });

  return redirect('/admin/login');
};
