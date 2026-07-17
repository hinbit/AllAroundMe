import express from 'express';
import path from 'path';
import { upstreamRequest, upstreamHeaders } from './services/upstream.js';
import { config, CLIENT_DIR } from './env.js';
import { ping } from './db.js';
import trackRouter from './routes/track.js';
import tagsRouter from './routes/tags.js';
import reviewsRouter from './routes/reviews.js';
import doctorsRouter from './routes/doctors.js';
import hooksRouter from './routes/hooks.js';
import qrRouter from './routes/qr.js';
import configRouter from './routes/config.js';
import { analyzeProxy } from './routes/analyze.js';
import { startScheduler } from './services/scheduler.js';

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

// ---------------------------------------------------------------- health ----
app.get(['/api/health', '/health'], async (req, res) => {
  const [db, eshkolot] = await Promise.all([
    ping().then(() => true).catch(() => false),
    fetch(config.eshkolotApi + '/health', { signal: AbortSignal.timeout(2500) })
      .then((r) => r.ok).catch(() => false),
  ]);
  res.json({ ok: true, service: 'allaroundme', port: config.port, db, eshkolot });
});

// ------------------------------------------- /api/public/* -> Eshkolot ------
// The map UI (adapted round-table live map) keeps calling /api/public/nearby,
// /api/public/filters etc. — we stream those straight to the alphon.
// /api/public/analyze is intercepted: same streaming proxy, but the response
// (transcript + AI triage) is also logged into our transcripts table.
app.post('/api/public/analyze', analyzeProxy);

app.use('/api/public', (req, res) => {
  const target = new URL(config.eshkolotApi + '/public' + req.url);
  const up = upstreamRequest(target, { method: req.method, headers: upstreamHeaders(req.headers, target) }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  up.on('error', (err) => {
    console.error(`[allaroundme] upstream ${target.href} failed: ${err.message}`);
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'שרת אלפון אשכולות אינו זמין', upstream: config.eshkolotApi }));
  });
  req.pipe(up);
});

// --------------------------------------------------------------- own API ----
app.use(express.json({ limit: '2mb' }));
app.use('/api', configRouter);     // public client config (Google Maps browser key)
app.use('/api', trackRouter);      // sessions, events, profile, points, badges
app.use('/api', tagsRouter);       // tag tree (alphon + local fallback)
app.use('/api', reviewsRouter);    // reviews + review-on-review
app.use('/api/doctor', doctorsRouter); // doctor auth, questionnaires, reports, shares
app.use('/api/hooks', hooksRouter);    // answer webhook for the WhatsApp bot / email flow
app.use('/api/qr', qrRouter);          // desk-QR scans + the identified-patient flow

app.use('/api', (req, res) => res.status(404).json({ error: 'לא נמצא' }));

// ---------------------------------------------------------------- client ----
// /q/<assignment_id>?w=&s= — what the desk QR encodes. The page reads its own
// query string and calls /api/qr/resolve; the signature is checked there.
app.get('/q/:id', (req, res) => res.sendFile(path.join(CLIENT_DIR, 'visit.html')));

app.use(express.static(CLIENT_DIR, { extensions: ['html'] }));

/* A request that names a file extension wants that file, not the app shell.
   Answering those with index.html turned every missing asset into a 200 of HTML,
   which reaches the browser as a corrupt image/audio/script instead of an honest
   404 — hard to diagnose and impossible to feature-detect against. Only
   extension-less paths (real routes) fall through to the SPA. */
app.get('*', (req, res) => {
  if (path.extname(req.path)) return res.status(404).send('Not found');
  res.sendFile(path.join(CLIENT_DIR, 'index.html'));
});

app.listen(config.port, () => {
  console.log(`[allaroundme] listening on http://127.0.0.1:${config.port}`);
  console.log(`[allaroundme] proxying /api/public -> ${config.eshkolotApi}/public`);
  console.log(`[allaroundme] whatsapp mode: ${config.whatsapp.mode} · smtp: ${config.smtp.host || 'log'}`);
  startScheduler();
});
