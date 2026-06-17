import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  output: 'server',
  // Image generation (Gemini) takes ~22s/image; allow long-running functions
  // (backfill, auto-publish cron) up to Vercel's 300s ceiling.
  adapter: vercel({ maxDuration: 300 }),
  vite: {
    plugins: [tailwindcss()],
  },
});
