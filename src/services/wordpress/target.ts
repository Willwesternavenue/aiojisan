// Which WordPress site a post goes to. Defaults to the AIおじさん site so
// every existing caller keeps its current behaviour.

import { getEnv } from '@/lib/env';

export type WordPressTargetName = 'aiojisan' | 'ichikarablog';

export interface WordPressTarget {
  name: WordPressTargetName;
  baseUrl: string;
  username: string;
  appPassword: string;
}

export function resolveWordPressTarget(name: WordPressTargetName = 'aiojisan'): WordPressTarget {
  const env = getEnv();

  if (name === 'ichikarablog') {
    const baseUrl = env.ICHIKARA_WP_BASE_URL;
    const username = env.ICHIKARA_WP_USERNAME;
    const appPassword = env.ICHIKARA_WP_APP_PASSWORD;
    if (!baseUrl || !username || !appPassword) {
      throw new Error(
        'ichikarablog is not configured: set ICHIKARA_WP_BASE_URL, ICHIKARA_WP_USERNAME and ICHIKARA_WP_APP_PASSWORD',
      );
    }
    return { name, baseUrl, username, appPassword };
  }

  return {
    name: 'aiojisan',
    baseUrl: env.WORDPRESS_BASE_URL,
    username: env.WORDPRESS_USERNAME,
    appPassword: env.WORDPRESS_APP_PASSWORD,
  };
}
