import express from 'express';
import bodyParser from 'body-parser';
import { obfuscate } from './obfuscate.js';

const app = express();

// serve static frontend
app.use(express.static('public'));

// accept JSON up to ~5 MB
app.use(bodyParser.json({ limit: '5mb' }));

// POST /obfuscate  → returns { ok, output | error }
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

// health check (optional)
app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log('lua-obf listening on :' + PORT);
});