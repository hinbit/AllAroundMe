import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { config, CLIENT_DIR } from '../env.js';

const router = express.Router();

let cache = { at: 0, data: null };

// GET /api/tags/tree — the alphon tag tree for the drill-down finder.
// Primary source: Eshkolot /api/public/tags-tree (added for this app).
// Fallback: client/data/tags-fallback.json so the finder keeps working
// when the alphon is down or not yet installed.
router.get('/tags/tree', async (req, res) => {
  if (cache.data && Date.now() - cache.at < 5 * 60_000) {
    return res.json(cache.data);
  }
  try {
    const r = await fetch(config.eshkolotApi + '/public/tags-tree', { signal: AbortSignal.timeout(4000) });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const data = await r.json();
    if (!Array.isArray(data.tree) || !data.tree.length) throw new Error('empty tree');
    cache = { at: Date.now(), data: { source: 'eshkolot', tree: data.tree } };
    return res.json(cache.data);
  } catch {
    try {
      const raw = await fs.readFile(path.join(CLIENT_DIR, 'data', 'tags-fallback.json'), 'utf8');
      const tree = JSON.parse(raw);
      return res.json({ source: 'fallback', tree });
    } catch {
      return res.status(502).json({ error: 'עץ התגיות אינו זמין' });
    }
  }
});

export default router;
