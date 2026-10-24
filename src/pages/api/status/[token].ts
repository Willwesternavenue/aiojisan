// GET /api/status/<token> — same digest, token in the path.
//
// Some fetch tools strip query strings, which makes ?status_token= arrive
// empty and the request read as unauthenticated. Carrying the token as a path
// segment survives any URL handling.

import type { APIRoute } from 'astro';
import { buildStatusDigest } from '@/services/status';

function unauthorized(): Response {
  return new Response('Unauthorized', { status: 401 });
}

export const GET: APIRoute = async ({ params }) => {
  const expected = import.meta.env.STATUS_TOKEN as string | undefined;
  if (!expected) return unauthorized();

  const given = params.token ?? '';
  // Length check first so the comparison below is over equal-length strings.
  if (given.length !== expected.length) return unauthorized();

  // Constant-time compare: this token sits in a URL that may be retried, so
  // avoid leaking a prefix match through response timing.
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= given.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (diff !== 0) return unauthorized();

  return buildStatusDigest();
};
