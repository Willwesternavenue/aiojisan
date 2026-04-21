// Server-side environment variable validation
// Import this only in server-side code (API routes, services)

import { z } from 'zod';

const envSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  OPENAI_API_KEY: z.string().startsWith('sk-'),  // covers sk- and sk-proj- formats
  WORDPRESS_BASE_URL: z.string().url(),
  WORDPRESS_USERNAME: z.string().min(1),
  WORDPRESS_APP_PASSWORD: z.string().min(1),
  ADMIN_SECRET: z.string().min(16),
  CRON_SECRET: z.string().min(16),
  // Optional
  ANTHROPIC_API_KEY: z.string().optional(),
});

type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;

  const result = envSchema.safeParse(import.meta.env);
  if (!result.success) {
    const missing = result.error.issues.map((i) => i.path.join('.')).join(', ');
    throw new Error(`Missing or invalid environment variables: ${missing}`);
  }

  _env = result.data;
  return _env;
}

// Convenience exports for frequently used values
export const getSupabaseUrl = () => getEnv().SUPABASE_URL;
export const getSupabaseServiceKey = () => getEnv().SUPABASE_SERVICE_ROLE_KEY;
export const getSupabaseAnonKey = () => getEnv().SUPABASE_ANON_KEY;
export const getOpenAiKey = () => getEnv().OPENAI_API_KEY;
export function getAnthropicKey(): string {
  const key = getEnv().ANTHROPIC_API_KEY;
  if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
  return key;
}
