'use strict';
/*
  Posts storage.
  - Vercel / cloud : Upstash Redis (REST) - set by Vercel Marketplace as KV_REST_API_URL / KV_REST_API_TOKEN
  - Apne computer par : data/posts.json file (pehle jaisa)
*/
const fs = require('fs');
const path = require('path');

const REDIS_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const REDIS_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const useRedis = !!(REDIS_URL && REDIS_TOKEN);
const POSTS_KEY = 'vc:posts';

async function redis(cmd) {
  const r = await fetch(REDIS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${REDIS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd),
    signal: AbortSignal.timeout(8000),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(`Redis error: ${j.error || r.status}`);
  return j.result;
}

/* ---------- file mode ---------- */
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const POSTS_FILE = path.join(DATA_DIR, 'posts.json');

function loadFile() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(POSTS_FILE)) return [];
  const raw = fs.readFileSync(POSTS_FILE, 'utf8');
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    const copy = path.join(DATA_DIR, `posts.damaged-${Date.now()}.json`);
    fs.writeFileSync(copy, raw);
    console.error(`posts.json पढ़ नहीं पाया. कॉपी रखी गई: ${copy}`);
    return [];
  }
}

function saveFile(posts) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${POSTS_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(posts, null, 2));
  fs.renameSync(tmp, POSTS_FILE);
}

/* ---------- public API ---------- */
async function loadPosts() {
  if (!useRedis) return loadFile();
  const raw = await redis(['GET', POSTS_KEY]);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    throw new Error('Redis me posts damaged hain');
  }
}

async function savePosts(posts) {
  if (!useRedis) return saveFile(posts);
  await redis(['SET', POSTS_KEY, JSON.stringify(posts)]);
}

/* login-attempt counter: Redis me (sabhi instances ke liye), warna memory me */
const mem = new Map();
async function hit(key, windowSec) {
  if (useRedis) {
    const n = await redis(['INCR', key]);
    if (n === 1) await redis(['EXPIRE', key, String(windowSec)]);
    return n;
  }
  const now = Date.now();
  const rec = mem.get(key);
  if (!rec || now - rec.t > windowSec * 1000) { mem.set(key, { n: 1, t: now }); return 1; }
  rec.n += 1;
  return rec.n;
}
async function reset(key) {
  if (useRedis) return redis(['DEL', key]);
  mem.delete(key);
  return null;
}
async function count(key) {
  if (useRedis) return Number(await redis(['GET', key])) || 0;
  const rec = mem.get(key);
  return rec ? rec.n : 0;
}

module.exports = { useRedis, loadPosts, savePosts, hit, reset, count };
