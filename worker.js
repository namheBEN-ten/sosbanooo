// SOS BANOO Cloudflare Worker
// Bind a D1 database to this Worker with the variable name: DB
// Create an encrypted Secret named: ADMIN_PASSWORD

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
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
}

async function makeToken(secret) {
  const payload = `${Date.now() + 8 * 60 * 60 * 1000}`;
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

async function requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return !!env.ADMIN_PASSWORD && await validToken(env.ADMIN_PASSWORD, token);
}

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      time TEXT NOT NULL,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      address TEXT NOT NULL,
      note TEXT,
      items_json TEXT NOT NULL,
      total INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      text TEXT NOT NULL,
      time TEXT NOT NULL
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_chat_session ON chat_messages(session_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_orders_time ON orders(id)`)
  ]);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (!env.ADMIN_PASSWORD) return json({ error: 'ADMIN_PASSWORD secret is not configured.' }, 500, origin);
    if (!env.DB) return json({ error: 'D1 database binding DB is not configured.' }, 500, origin);

    const url = new URL(request.url);

    // ---------- Authentication ----------
    if (url.pathname === '/api/auth/login' && request.method === 'POST') {
      try {
        const body = await request.json();
        const password = typeof body.password === 'string' ? body.password : '';
        if (!password || password.length > 256) return json({ error: 'Invalid credentials.' }, 401, origin);
        await new Promise(resolve => setTimeout(resolve, 250));
        if (password !== env.ADMIN_PASSWORD) return json({ error: 'Invalid credentials.' }, 401, origin);
        return json({ ok: true, token: await makeToken(env.ADMIN_PASSWORD) }, 200, origin);
      } catch (_) {
        return json({ error: 'Invalid request.' }, 400, origin);
      }
    }

    if (url.pathname === '/api/auth/verify' && request.method === 'GET') {
      return json({ ok: await requireAdmin(request, env) }, 200, origin);
    }

    // Create tables automatically on first API use.
    try { await ensureSchema(env.DB); }
    catch (e) { return json({ error: 'Database initialization failed.' }, 500, origin); }

    // ---------- Orders ----------
    if (url.pathname === '/api/orders' && request.method === 'POST') {
      try {
        const body = await request.json();
        const required = ['id', 'time', 'name', 'phone', 'address', 'items', 'total'];
        for (const key of required) if (body[key] === undefined || body[key] === null) return json({ error: `Missing ${key}` }, 400, origin);
        if (!Array.isArray(body.items)) return json({ error: 'Invalid items.' }, 400, origin);

        await env.DB.prepare(`INSERT INTO orders
          (id,time,name,phone,address,note,items_json,total)
          VALUES (?,?,?,?,?,?,?,?)`)
          .bind(
            String(body.id), String(body.time), String(body.name).slice(0, 200), String(body.phone).slice(0, 50),
            String(body.address).slice(0, 1000), String(body.note || '').slice(0, 1000),
            JSON.stringify(body.items), Number(body.total) || 0
          ).run();

        return json({ ok: true }, 201, origin);
      } catch (e) {
        return json({ error: 'Could not save order.' }, 400, origin);
      }
    }

    if (url.pathname === '/api/orders' && request.method === 'GET') {
      if (!await requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401, origin);
      const result = await env.DB.prepare(`SELECT * FROM orders ORDER BY rowid DESC LIMIT 500`).all();
      const orders = (result.results || []).map(o => ({
        id: o.id, time: o.time, name: o.name, phone: o.phone, address: o.address,
        note: o.note || '', items: JSON.parse(o.items_json || '[]'), total: Number(o.total) || 0
      }));
      return json({ ok: true, orders }, 200, origin);
    }

    // ---------- Customer chat ----------
    if (url.pathname === '/api/chat' && request.method === 'POST') {
      try {
        const body = await request.json();
        const sessionId = String(body.sessionId || '').slice(0, 100);
        const text = String(body.text || '').trim().slice(0, 2000);
        const time = String(body.time || new Date().toLocaleString('fa-IR')).slice(0, 100);
        if (!sessionId || !text) return json({ error: 'Invalid message.' }, 400, origin);
        const id = `${Date.now()}-${crypto.randomUUID()}`;
        await env.DB.prepare(`INSERT INTO chat_messages (id,session_id,sender,text,time) VALUES (?,?,?,?,?)`)
          .bind(id, sessionId, 'user', text, time).run();
        return json({ ok: true, id }, 201, origin);
      } catch (_) { return json({ error: 'Could not save message.' }, 400, origin); }
    }

    if (url.pathname === '/api/chat' && request.method === 'GET') {
      const sessionId = (url.searchParams.get('sessionId') || '').slice(0, 100);
      if (!sessionId) return json({ error: 'Missing sessionId.' }, 400, origin);
      const result = await env.DB.prepare(`SELECT id,session_id,sender,text,time FROM chat_messages WHERE session_id=? ORDER BY rowid ASC LIMIT 500`).bind(sessionId).all();
      return json({ ok: true, messages: result.results || [] }, 200, origin);
    }

    if (url.pathname === '/api/admin/chats' && request.method === 'GET') {
      if (!await requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401, origin);
      const result = await env.DB.prepare(`SELECT id,session_id,sender,text,time FROM chat_messages ORDER BY rowid ASC LIMIT 2000`).all();
      return json({ ok: true, messages: result.results || [] }, 200, origin);
    }

    if (url.pathname.startsWith('/api/admin/chat/message/') && request.method === 'DELETE') {
      if (!await requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401, origin);
      const messageId = decodeURIComponent(url.pathname.substring('/api/admin/chat/message/'.length)).slice(0, 200);
      if (!messageId) return json({ error: 'Missing message id.' }, 400, origin);
      try {
        const result = await env.DB.prepare('DELETE FROM chat_messages WHERE id=?').bind(messageId).run();
        return json({ ok: true, deleted: Number(result.meta?.changes || 0) }, 200, origin);
      } catch (_) {
        return json({ error: 'Could not delete message.' }, 400, origin);
      }
    }

    if (url.pathname === '/api/admin/chat/reply' && request.method === 'POST') {
      if (!await requireAdmin(request, env)) return json({ error: 'Unauthorized.' }, 401, origin);
      try {
        const body = await request.json();
        const sessionId = String(body.sessionId || '').slice(0, 100);
        const text = String(body.text || '').trim().slice(0, 2000);
        const time = String(body.time || new Date().toLocaleString('fa-IR')).slice(0, 100);
        if (!sessionId || !text) return json({ error: 'Invalid reply.' }, 400, origin);
        const id = `${Date.now()}-${crypto.randomUUID()}`;
        await env.DB.prepare(`INSERT INTO chat_messages (id,session_id,sender,text,time) VALUES (?,?,?,?,?)`)
          .bind(id, sessionId, 'admin', text, time).run();
        return json({ ok: true, id }, 201, origin);
      } catch (_) { return json({ error: 'Could not save reply.' }, 400, origin); }
    }

    return new Response('SOS BANOO API is online.', {
      status: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8', ...corsHeaders(origin) }
    });
  }
};
