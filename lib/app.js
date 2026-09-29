'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const net = require('net');
const express = require('express');
const { extractPage } = require('./extract');
const store = require('./store');

const ROOT = path.join(__dirname, '..');
const ON_VERCEL = !!process.env.VERCEL;

/* ------------------------------------------------------------------ */
/*  Settings (.env) - tiny loader, no extra dependency                 */
/* ------------------------------------------------------------------ */
const ENV_FILE = path.join(ROOT, '.env');
if (fs.existsSync(ENV_FILE)) {
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

let passwordWasGenerated = false;
if (!process.env.ADMIN_PASSWORD && ON_VERCEL) {
  console.error('ADMIN_PASSWORD set nahi hai - Vercel > Settings > Environment Variables me daalein.');
} else if (!process.env.ADMIN_PASSWORD) {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let pw = '';
  for (const b of crypto.randomBytes(10)) pw += chars[b % chars.length];
  process.env.ADMIN_PASSWORD = pw;
  passwordWasGenerated = true;
  try {
    const hasContent = fs.existsSync(ENV_FILE) && fs.statSync(ENV_FILE).size > 0;
    fs.appendFileSync(ENV_FILE, `${hasContent ? '\n' : ''}ADMIN_PASSWORD=${pw}\n`);
  } catch (_) { /* read-only disk: password lives for this run only */ }
}
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(ROOT, 'public');

/* ------------------------------------------------------------------ */
/*  Posts storage (one JSON file)                                      */
/* ------------------------------------------------------------------ */
/* posts ab lib/store.js se aate hain (Redis ya file) */

/* ------------------------------------------------------------------ */
/*  Validation                                                         */
/* ------------------------------------------------------------------ */
const CATS = ['job', 'admit', 'result'];
const str = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max);
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : '');

function safeUrl(u) {
  try {
    const x = new URL(String(u || '').trim());
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : '';
  } catch (_) {
    return '';
  }
}

function cleanPost(body) {
  body = body || {};
  const title = str(body.title, 200);
  if (!title) return { error: 'Title जरूरी है' };
  if (!CATS.includes(body.category)) return { error: 'Category चुनें (भर्ती / एडमिट कार्ड / रिज़ल्ट)' };

  const details = (Array.isArray(body.details) ? body.details : []).slice(0, 60)
    .map((d) => ({ group: str(d && d.group, 60), label: str(d && d.label, 120), value: str(d && d.value, 500) }))
    .filter((d) => d.label && d.value);
  const links = (Array.isArray(body.links) ? body.links : []).slice(0, 20)
    .map((l) => ({ label: str(l && l.label, 80), url: safeUrl(l && l.url) }))
    .filter((l) => l.label && l.url);

  return {
    value: {
      title,
      category: body.category,
      org: str(body.org, 120),
      note: str(body.note, 300),
      keyDate: isoDate(str(body.keyDate, 10)),
      keyDateLabel: str(body.keyDateLabel, 30),
      details,
      links,
      source: safeUrl(body.source),
      showSource: !!body.showSource,
      ticker: body.ticker !== false,
    },
  };
}

const byNewest = (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt);
const publicView = (p) => (p.showSource ? p : { ...p, source: '' });

/* ------------------------------------------------------------------ */
/*  Fetching a page safely (admin only)                                */
/* ------------------------------------------------------------------ */
class UserError extends Error {}

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l.startsWith('::ffff:') && net.isIPv4(l.slice(7))) return isPrivateIp(l.slice(7));
    return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80');
  }
  return true;
}

async function assertPublicHost(hostname) {
  if (process.env.ALLOW_LOCAL_FETCH === '1') return;
  let addrs;
  try { addrs = await dns.lookup(hostname, { all: true }); } catch (_) { throw new UserError('यह साइट खुल नहीं रही — लिंक जाँचें'); }
  if (!addrs.length || addrs.some((a) => isPrivateIp(a.address))) throw new UserError('यह लिंक allowed नहीं है');
}

async function fetchHtml(startUrl) {
  let url = startUrl;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicHost(new URL(url).hostname);
    let r;
    try {
      r = await fetch(url, {
        redirect: 'manual',
        signal: AbortSignal.timeout(15000),
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; VivekComputerBot/1.0)',
          Accept: 'text/html,application/xhtml+xml',
          'Accept-Language': 'hi,en;q=0.8',
        },
      });
    } catch (e) {
      if (e && e.name === 'TimeoutError') throw new UserError('पेज खुलने में बहुत देर लगी — थोड़ी देर बाद फिर try करें');
      throw new UserError('पेज नहीं खुला — लिंक जाँचें या नीचे manually भर दें');
    }
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.get('location');
      if (!loc) break;
      url = new URL(loc, url).href;
      continue;
    }
    if (!r.ok) throw new UserError(`साइट ने पेज नहीं दिया (HTTP ${r.status}). नीचे manually भर दें।`);
    if (!/html|xml/i.test(r.headers.get('content-type') || '')) throw new UserError('यह लिंक वेब-पेज नहीं है (शायद PDF/फ़ाइल है)');
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 3_000_000) throw new UserError('पेज बहुत बड़ा है');
    return { html: buf.toString('utf8'), finalUrl: url };
  }
  throw new UserError('लिंक बहुत बार आगे भेजा गया (redirect)');
}

/* ------------------------------------------------------------------ */
/*  Admin sessions                                                     */
/* ------------------------------------------------------------------ */
const SESSION_MS = 7 * 24 * 3600 * 1000;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const SESSION_KEY = crypto.createHash('sha256').update(`vc-session:${process.env.SESSION_SECRET || ADMIN_PASSWORD}`).digest();
const sign = (payload) => crypto.createHmac('sha256', SESSION_KEY).update(payload).digest('hex');

// Stateless token: "<expiry>.<signature>" - serverless par bhi kaam karta hai
function makeToken() {
  const exp = String(Date.now() + SESSION_MS);
  return `${exp}.${sign(exp)}`;
}

function cookieOf(req, name) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return '';
}

function validToken(t) {
  if (!ADMIN_PASSWORD || !t) return false;
  const [exp, sig] = String(t).split('.');
  if (!exp || !sig || !/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;
  const good = Buffer.from(sign(exp));
  const got = Buffer.from(sig);
  return good.length === got.length && crypto.timingSafeEqual(good, got);
}

function requireAuth(req, res, next) {
  if (!validToken(cookieOf(req, 'vc_admin'))) return res.status(401).json({ error: 'Login जरूरी है' });
  next();
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/* ------------------------------------------------------------------ */
/*  App                                                                */
/* ------------------------------------------------------------------ */
const app = express();
if (process.env.TRUST_PROXY === '1' || ON_VERCEL) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  next();
});
app.use(express.json({ limit: '300kb' }));

/* ---- public ---- */
app.get('/api/posts', wrap(async (req, res) => {
  res.set('Cache-Control', 'public, max-age=30, s-maxage=30, stale-while-revalidate=60');
  const posts = await store.loadPosts();
  res.json(posts.sort(byNewest).map(publicView));
}));

/* ---- admin: session ---- */
app.post('/api/admin/login', wrap(async (req, res) => {
  if (!ADMIN_PASSWORD) return res.status(500).json({ error: 'Server me ADMIN_PASSWORD set नहीं है' });
  const key = `vc:login:${req.ip}`;
  if ((await store.count(key)) >= 6) return res.status(429).json({ error: 'बहुत ज़्यादा कोशिशें — 15 मिनट बाद फिर try करें' });

  const ok = crypto.timingSafeEqual(sha(req.body && req.body.password), sha(ADMIN_PASSWORD));
  if (!ok) {
    await store.hit(key, 15 * 60);
    return res.status(401).json({ error: 'Password गलत है' });
  }
  await store.reset(key);
  const secure = req.secure ? '; Secure' : '';
  res.set('Set-Cookie', `vc_admin=${makeToken()}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_MS / 1000}${secure}`);
  res.json({ ok: true });
}));

app.post('/api/admin/logout', (req, res) => {
  res.set('Set-Cookie', 'vc_admin=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
  res.json({ ok: true });
});

app.get('/api/admin/me', requireAuth, (req, res) => res.json({ ok: true }));

/* ---- admin: posts ---- */
app.get('/api/admin/posts', requireAuth, wrap(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json((await store.loadPosts()).sort(byNewest));
}));

app.post('/api/admin/posts', requireAuth, wrap(async (req, res) => {
  const r = cleanPost(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  const posts = await store.loadPosts();
  const now = new Date().toISOString();
  const post = { id: crypto.randomBytes(5).toString('hex'), createdAt: now, updatedAt: now, ...r.value };
  posts.unshift(post);
  await store.savePosts(posts);
  res.status(201).json(post);
}));

app.put('/api/admin/posts/:id', requireAuth, wrap(async (req, res) => {
  const posts = await store.loadPosts();
  const i = posts.findIndex((p) => p.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'पोस्ट नहीं मिली' });
  const r = cleanPost(req.body);
  if (r.error) return res.status(400).json({ error: r.error });
  posts[i] = { ...posts[i], ...r.value, updatedAt: new Date().toISOString() };
  await store.savePosts(posts);
  res.json(posts[i]);
}));

app.delete('/api/admin/posts/:id', requireAuth, wrap(async (req, res) => {
  const posts = await store.loadPosts();
  const i = posts.findIndex((p) => p.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: 'पोस्ट नहीं मिली' });
  posts.splice(i, 1);
  await store.savePosts(posts);
  res.json({ ok: true });
}));

app.get('/api/admin/backup', requireAuth, wrap(async (req, res) => {
  const posts = await store.loadPosts();
  res.set('Content-Disposition', `attachment; filename="posts-backup-${new Date().toISOString().slice(0, 10)}.json"`);
  res.type('application/json').send(JSON.stringify(posts, null, 2));
}));

/* ---- admin: read details from a link ---- */
app.post('/api/admin/fetch', requireAuth, async (req, res) => {
  const url = safeUrl(req.body && req.body.url);
  if (!url) return res.status(400).json({ error: 'सही लिंक डालें (https://... से शुरू होने वाला)' });
  try {
    const { html, finalUrl } = await fetchHtml(url);
    res.json(extractPage(html, finalUrl));
  } catch (e) {
    if (e instanceof UserError) return res.status(502).json({ error: e.message });
    console.error('fetch error:', e);
    res.status(500).json({ error: 'पेज पढ़ने में दिक्कत आई — manually भर दें' });
  }
});

/* ---- static site ---- */
app.use(express.static(PUBLIC_DIR, { extensions: ['html'] }));

app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'गलत डेटा भेजा गया' });
  console.error(err);
  res.status(500).json({ error: 'Server में गड़बड़ हुई' });
});

module.exports = app;
module.exports.start = function start() {
  app.listen(PORT, () => {
    console.log('\n  Vivek Computer site चालू है\n');
    console.log(`  वेबसाइट : http://localhost:${PORT}`);
    console.log(`  एडमिन   : http://localhost:${PORT}/admin/`);
    if (passwordWasGenerated) {
      console.log(`\n  पहली बार का Admin Password: ${ADMIN_PASSWORD}`);
      console.log('  (यह .env फ़ाइल में भी सेव हो गया है — वहाँ बदल सकते हैं)\n');
    } else if (ADMIN_PASSWORD.length < 8) {
      console.log('\n  ध्यान दें: Password छोटा है. .env में लंबा password रखें.\n');
    }
  });
};
