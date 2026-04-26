import crypto from 'node:crypto';
import { createLogger } from '@/lib/logger';

const logger = createLogger('x-auto-post');

type XCredentials = {
  apiKey: string;
  apiSecret: string;
  accessToken: string;
  accessTokenSecret: string;
};

type AutoPostInput = {
  text: string;
  articleId: string;
  url: string;
};

function getCredential(name: string, fallbackName: string): string | undefined {
  return process.env[name]
    ?? process.env[fallbackName]
    ?? (import.meta.env[name] as string | undefined)
    ?? (import.meta.env[fallbackName] as string | undefined);
}

function getXCredentials(): XCredentials | null {
  const credentials = {
    apiKey: getCredential('X_API_KEY', 'TWITTER_API_KEY'),
    apiSecret: getCredential('X_API_SECRET', 'TWITTER_API_SECRET'),
    accessToken: getCredential('X_ACCESS_TOKEN', 'TWITTER_ACCESS_TOKEN'),
    accessTokenSecret: getCredential('X_ACCESS_TOKEN_SECRET', 'TWITTER_ACCESS_TOKEN_SECRET'),
  };

  if (
    !credentials.apiKey ||
    !credentials.apiSecret ||
    !credentials.accessToken ||
    !credentials.accessTokenSecret
  ) {
    return null;
  }

  return credentials as XCredentials;
}

function encode(value: string): string {
  return encodeURIComponent(value)
    .replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

function createOAuthHeader(method: string, url: string, credentials: XCredentials): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: credentials.apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: credentials.accessToken,
    oauth_version: '1.0',
  };

  const parameterString = Object.entries(oauthParams)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encode(key)}=${encode(value)}`)
    .join('&');

  const signatureBase = [
    method.toUpperCase(),
    encode(url),
    encode(parameterString),
  ].join('&');

  const signingKey = `${encode(credentials.apiSecret)}&${encode(credentials.accessTokenSecret)}`;
  const signature = crypto
    .createHmac('sha1', signingKey)
    .update(signatureBase)
    .digest('base64');

  return 'OAuth ' + Object.entries({ ...oauthParams, oauth_signature: signature })
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encode(key)}="${encode(value)}"`)
    .join(', ');
}

export async function postToX({ text, articleId, url }: AutoPostInput): Promise<{ tweeted: boolean; tweetId?: string }> {
  const credentials = getXCredentials();
  if (!credentials) {
    logger.warn('X credentials are not configured; skipping auto-post', { articleId, url });
    return { tweeted: false };
  }

  const endpoint = 'https://api.twitter.com/2/tweets';
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: createOAuthHeader('POST', endpoint, credentials),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X API error ${res.status}: ${body}`);
  }

  const body = await res.json() as { data?: { id?: string } };
  logger.info('Posted to X', { articleId, tweetId: body.data?.id });
  return { tweeted: true, tweetId: body.data?.id };
}
