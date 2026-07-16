import express from 'express';
import http from 'http';
import path from 'path';
import { config, CLIENT_DIR } from './env.js';
import { ping } from './db.js';
import trackRouter from './routes/track.js';
import tagsRouter from './routes/tags.js';
import reviewsRouter from './routes/reviews.js';
import doctorsRouter from './routes/doctors.js';
import hooksRouter from './routes/hooks.js';
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
  const headers = { ...req.headers, host: target.host };
  delete headers['accept-encoding'];
  const up = http.request(target, { method: req.method, headers }, (upRes) => {
    res.writeHead(upRes.statusCode || 502, upRes.headers);
    upRes.pipe(res);
  });
  up.on('error', () => {
    if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: 'שרת אלפון אשכולות אינו זמין', upstream: config.eshkolotApi }));
  });
  req.pipe(up);
});

// --------------------------------------------------------------- own API ----
app.use(express.json({ limit: '2mb' }));
app.use('/api', trackRouter);      // sessions, events, profile, points, badges
app.use('/api', tagsRouter);       // tag tree (alphon + local fallback)
app.use('/api', reviewsRouter);    // reviews + review-on-review
app.use('/api/doctor', doctorsRouter); // doctor auth, questionnaires, reports, shares
app.use('/api/hooks', hooksRouter);    // answer webhook for the WhatsApp bot / email flow

app.use('/api', (req, res) => res.status(404).json({ error: 'לא נמצא' }));

// ---------------------------------------------------------------- client ----
app.use(express.static(CLIENT_DIR, { extensions: ['html'] }));
app.get('*', (req, res) => res.sendFile(path.join(CLIENT_DIR, 'index.html')));

app.listen(config.port, () => {
  console.log(`[allaroundme] listening on http://127.0.0.1:${config.port}`);
  console.log(`[allaroundme] proxying /api/public -> ${config.eshkolotApi}/public`);
  console.log(`[allaroundme] whatsapp mode: ${config.whatsapp.mode} · smtp: ${config.smtp.host || 'log'}`);
  startScheduler();
});
