// In-process scheduler: dispatches due outbox messages every minute and runs
// the daily doctor digests once a day at DIGEST_HOUR. Disable with
// SCHEDULER_ENABLED='0' (e.g. when a separate worker handles delivery).
import { config } from '../env.js';
import { dispatchDueOutbox } from './whatsapp.js';
import { runDailyDigests } from './digest.js';
import { sweepUndelivered } from './phi.js';

let timer = null;
let busy = false;

export async function tick() {
  if (busy) return;
  busy = true;
  try {
    const r = await dispatchDueOutbox();
    if (r.sent) console.log(`[allaroundme] scheduler: sent ${r.sent}/${r.due} due messages`);

    // answers that never reached their doctor are still sitting here holding
    // patient identifiers — retrying is what lets us drop them
    const phi = await sweepUndelivered();
    if (phi.delivered) console.log(`[allaroundme] scheduler: handed ${phi.delivered}/${phi.pending} answer sets to doctors`);

    if (new Date().getHours() >= config.digestHour) {
      const results = await runDailyDigests();
      const sent = results.filter((x) => !x.skipped && !x.error).length;
      if (sent) console.log(`[allaroundme] scheduler: daily digests sent to ${sent} doctors`);
    }
  } catch (e) {
    console.error('[allaroundme] scheduler tick failed:', e.message);
  } finally {
    busy = false;
  }
}

export function startScheduler() {
  if (!config.schedulerEnabled || timer) return;
  timer = setInterval(tick, 60_000);
  timer.unref();
  setTimeout(tick, 2500).unref(); // catch anything already due right after boot
  console.log(`[allaroundme] scheduler on (outbox every 60s, digests from ${config.digestHour}:00)`);
}
