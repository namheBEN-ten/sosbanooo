// Cloudflare Worker for secure SOS BANOO admin authentication.
// Set the ADMIN_PASSWORD secret in Worker > Settings > Variables and Secrets.
// Do NOT put the password in this file or in GitHub.

const ALLOWED_ORIGINS = [
  'https://namheben-ten.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:5500',
  'http://localhost:5500'
];

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-store'
  };
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...corsHeaders(origin) }
  });
}

function base64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - s.length % 4) % 4));
  return Uint8Array.from(bin, c => c.charCodeAt(0));
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}

async function makeToken(secret) {
  const payload = `${Date.now() + 8 * 60 * 60 * 1000}`; // 8-hour session
  const sig = base64url(await hmac(secret, payload));
  return `${base64url(new TextEncoder().encode(payload))}.${sig}`;
}

async function validToken(secret, token) {
  if (!token || !token.includes('.')) return false;
  const [payload64, sig64] = token.split('.');
  try {
    const payload = new TextDecoder().decode(fromBase64url(payload64));
    const expires = Number(payload);
    if (!Number.isFinite(expires) || expires < Date.now()) return false;
    const expected = await hmac(secret, payload);
    const actual = fromBase64url(sig64);
    if (expected.length !== actual.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
    return diff === 0;
  } catch (_) {
    return false;
  }
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);

    if (!env.ADMIN_PASSWORD) {
      return json({ error: 'ADMIN_PASSWORD secret is not configured.' }, 500, origin);
    }

    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      try {
        const body = await request.json();
        const password = typeof body.password === 'string' ? body.password : '';
        if (!password || password.length > 256) return json({ error: 'Invalid credentials.' }, 401, origin);

        // Small delay makes repeated guessing slightly less convenient.
        await new Promise(resolve => setTimeout(resolve, 250));

        if (password !== env.ADMIN_PASSWORD) {
          return json({ error: 'Invalid credentials.' }, 401, origin);
        }

        return json({ ok: true, token: await makeToken(env.ADMIN_PASSWORD) }, 200, origin);
      } catch (_) {
        return json({ error: 'Invalid request.' }, 400, origin);
      }
    }

    if (url.pathname === '/api/auth/verify' && request.method === 'GET') {
      const auth = request.headers.get('Authorization') || '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      return json({ ok: await validToken(env.ADMIN_PASSWORD, token) }, 200, origin);
    }

    return new Response('SOS BANOO API is online.', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders(origin) }
    });
  }
};
