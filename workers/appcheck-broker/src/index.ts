/**
 * GhostLayer MV3 App Check Token Broker (Cloudflare Worker, zero npm dependencies).
 *
 * Allows Chrome Manifest V3 extensions (where CSP blocks remote reCAPTCHA scripts)
 * to obtain valid short-lived Firebase App Check tokens automatically for EVERY user.
 *
 * Required Cloudflare Worker secrets (`wrangler secret put ...`):
 *   - FIREBASE_SERVICE_ACCOUNT_EMAIL  (service account with Firebase App Check Token Creator role)
 *   - FIREBASE_PRIVATE_KEY            (PEM private key from the service account JSON)
 *   - FIREBASE_PROJECT_NUMBER         (e.g. "824344822742")
 *   - FIREBASE_APP_ID                 (e.g. "1:824344822742:web:...")
 *   - ALLOWED_EXTENSION_ORIGINS       (comma-separated, e.g. "chrome-extension://<id>")
 */

export interface Env {
  FIREBASE_SERVICE_ACCOUNT_EMAIL: string;
  FIREBASE_PRIVATE_KEY: string;
  FIREBASE_PROJECT_NUMBER: string;
  FIREBASE_APP_ID: string;
  ALLOWED_EXTENSION_ORIGINS: string;
}

const APP_CHECK_AUD =
  'https://firebaseappcheck.googleapis.com/google.firebase.appcheck.v1.TokenExchangeService';

function base64UrlEncode(data: Uint8Array | string): string {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const normalized = pem
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = atob(normalized);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return crypto.subtle.importKey(
    'pkcs8',
    bytes.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
}

async function signCustomAppCheckJwt(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64UrlEncode(
    JSON.stringify({
      iss: env.FIREBASE_SERVICE_ACCOUNT_EMAIL,
      sub: env.FIREBASE_SERVICE_ACCOUNT_EMAIL,
      aud: APP_CHECK_AUD,
      iat: now,
      exp: now + 60,
      app_id: env.FIREBASE_APP_ID,
    }),
  );

  const signingInput = `${header}.${payload}`;
  const key = await importPrivateKey(env.FIREBASE_PRIVATE_KEY);
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sig))}`;
}

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin') ?? '';
    const allowed = env.ALLOWED_EXTENSION_ORIGINS.split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    if (!origin || !allowed.includes(origin)) {
      return new Response(JSON.stringify({ error: 'Origin not allowed' }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
      });
    }

    try {
      const customToken = await signCustomAppCheckJwt(env);
      const exchangeUrl = `https://firebaseappcheck.googleapis.com/v1/projects/${env.FIREBASE_PROJECT_NUMBER}/apps/${env.FIREBASE_APP_ID}:exchangeCustomToken`;

      const exchangeResp = await fetch(exchangeUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customToken,
          limitedUse: false,
        }),
      });

      if (!exchangeResp.ok) {
        const errText = await exchangeResp.text();
        return new Response(
          JSON.stringify({ error: 'Token exchange failed', detail: errText }),
          {
            status: 502,
            headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
          },
        );
      }

      const data = (await exchangeResp.json()) as { token: string; ttl?: string };
      // Parse TTL like "3600s" (default 1 hour)
      const ttlSeconds = Number(data.ttl?.replace(/s$/i, '')) || 3600;
      const expireTimeMillis = Date.now() + ttlSeconds * 1000;

      return new Response(
        JSON.stringify({ token: data.token, expireTimeMillis }),
        {
          status: 200,
          headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
        },
      );
    } catch (err) {
      return new Response(
        JSON.stringify({
          error: err instanceof Error ? err.message : 'Internal broker error',
        }),
        {
          status: 500,
          headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
        },
      );
    }
  },
};
