// CLI: send the daily doctor digests right now (also runs daily in-server).
//   node scripts/digest.js            — doctors who didn't get one today
//   node scripts/digest.js --force    — everyone, even with no news
import { log } from './env.js';
import { runDailyDigests } from '../server/services/digest.js';

const force = process.argv.includes('--force');
runDailyDigests({ force })
  .then((results) => {
    for (const r of results) {
      log(r.error ? `digest ${r.doctor}: FAILED ${r.error}`
        : r.skipped ? `digest ${r.doctor}: skipped (no news)`
        : `digest ${r.doctor}: sent via ${r.via.join('+') || 'log'} (${JSON.stringify(r.counts)})`);
    }
    if (!results.length) log('digest: no doctors due');
    process.exit(0);
  })
  .catch((e) => { console.error('[allaroundme] digest failed:', e.message); process.exit(1); });
