import http from 'http';
import { config } from '../env.js';
import { query } from '../db.js';

// Streams POST /api/public/analyze (multipart audio or urlencoded/JSON text)
// to the alphon unchanged, captures the JSON response, and logs the full
// triage trail — transcript, AI recommendation, tags, urgency — into our
// transcripts table. The uid/session come from query params the client adds
// (?uid=&session=&source=) so the multipart body stays untouched.
export function analyzeProxy(req, res) {
  const uid = String(req.query.uid || '').slice(0, 24) || null;
  const sessionId = parseInt(req.query.session, 10) || null;
  const source = req.query.source === 'text' ? 'text' : 'voice';

  const target = new URL(config.eshkolotApi + '/public/analyze');
  const headers = { ...req.headers, host: target.host };
  delete headers['accept-encoding'];

  const up = http.request(target, { method: 'POST', headers }, (upRes) => {
    const chunks = [];
    upRes.on('data', (c) => chunks.push(c));
    upRes.on('end', () => {
      const body = Buffer.concat(chunks);
      res.writeHead(upRes.statusCode || 502, upRes.headers);
      res.end(body);

      // best-effort logging — never blocks the user
      let parsed = null;
      try { parsed = JSON.parse(body.toString('utf8')); } catch { /* not JSON */ }
      const ok = (upRes.statusCode || 0) < 400 && parsed && !parsed.error;
      query(
        `INSERT INTO transcripts (uid, session_id, source, transcript, ai_recommendation, ai_tags, urgent, ai_ok, error)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [
          uid, sessionId, source,
          parsed?.text || null,
          parsed?.recommendation || null,
          parsed?.tags ? JSON.stringify(parsed.tags) : null,
          parsed?.urgent ? 1 : 0,
          ok ? 1 : 0,
          ok ? null : String(parsed?.error || `upstream ${upRes.statusCode}`).slice(0, 300),
        ]
      ).catch((e) => console.error('[allaroundme] transcript log failed:', e.message));
    });
  });
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'שרת אלפון אשכולות אינו זמין' }));
    query(
      `INSERT INTO transcripts (uid, session_id, source, ai_ok, error) VALUES (?,?,?,0,'eshkolot unreachable')`,
      [uid, sessionId, source]
    ).catch(() => {});
  });
  req.pipe(up);
}
