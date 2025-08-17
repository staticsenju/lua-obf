import express from 'express';
import bodyParser from 'body-parser';
import * as cheerio from 'cheerio';
import crypto from 'node:crypto';
import { obfuscate } from './obfuscate.js';

const app = express();
app.use(express.static('public'));
app.use(bodyParser.json({ limit: '5mb' }));

/* ---------- Obfuscation API ---------- */
app.post('/obfuscate', (req, res) => {
  const { code, options } = req.body || {};
  if (!code || typeof code !== 'string') {
    return res.status(400).json({ ok: false, error: 'No code provided' });
  }
  try {
    const out = obfuscate(code, options || {});
    res.json({ ok: true, output: out });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------- Link Preview (OG/Twitter/HTML) ---------- */
app.post('/preview', async (req, res) => {
  try {
    const { url, screenshot } = req.body || {};
    if (!url) return res.status(400).json({ ok: false, error: 'No URL' });

    const resp = await fetch(url, {
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome' },
      redirect: 'follow'
    });
    const html = await resp.text();
    const $ = cheerio.load(html);

    const pick = (...sel) => sel
      .map(s => $(s).attr('content') || $(s).attr('href') || $(s).text())
      .find(Boolean);

    let title = pick('meta[property="og:title"]','meta[name="twitter:title"]') || $('title').text() || '';
    let description = pick('meta[property="og:description"]','meta[name="description"]','meta[name="twitter:description"]') || '';
    let image = pick('meta[property="og:image"]','meta[name="twitter:image"]') || '';
    let siteName = pick('meta[property="og:site_name"]') || new URL(url).hostname;
    let icon = $('link[rel="icon"]').attr('href') || $('link[rel="shortcut icon"]').attr('href') || '';

    const abs = u => { try { return u ? new URL(u, url).toString() : ''; } catch { return ''; } };
    image = abs(image); icon = abs(icon);

    if (!image && screenshot) {
      try { image = await screenshotURL(url); } catch { /* ignore */ }
    }

    res.json({ ok: true, title, description, image, siteName, icon, url });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/* ---------- Optional Puppeteer screenshot ---------- */
async function screenshotURL(url) {
  const puppeteer = await import('puppeteer');
  const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720, deviceScaleFactor: 1 });
  await page.goto(url, { waitUntil: ['domcontentloaded','networkidle0'], timeout: 20000 });
  const buf = await page.screenshot({ type: 'jpeg', quality: 72 });
  await browser.close();
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

/* ---------- Image proxy for CORS-safe canvas ---------- */
app.get('/img', async (req, res) => {
  try {
    const u = req.query.url;
    if (!u) return res.status(400).send('no url');
    const r = await fetch(u, { redirect: 'follow' });
    if (!r.ok) return res.status(502).send('bad fetch');
    const ct = r.headers.get('content-type') || 'image/jpeg';
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', ct);
    res.send(buf);
  } catch (e) {
    res.status(500).send('img proxy error');
  }
});

/* ---------- Remote gate (optional) ---------- */
app.get('/key', (req, res) => {
  const SECRET = process.env.GATE_SECRET || 'change-me';
  const id = String(req.query.id || '');
  const now = Math.floor(Date.now() / 1000);
  const exp = now + 60; // 60s TTL
  const h = crypto.createHmac('sha256', SECRET).update(id + ':' + exp).digest();
  const gate = h[0]; // 0..255
  res.json({ g: gate, exp });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log('lua-obf listening on :' + PORT));
