// The WhatsApp wire, and nothing else: no database, no outbox, no business
// rules. It lives apart from whatsapp.js so that the PHI hand-off (phi.js) can
// put a message on the wire *without* persisting its body anywhere — see the
// note in phi.js about why that matters.
//
// WHATSAPP_MODE:
//   log       — dev default: print to the server log
//   cloud     — Meta WhatsApp Cloud API (WHATSAPP_TOKEN + WHATSAPP_PHONE_ID)
//   webhook   — POST {to, text, ...meta} to an external bot (WHATSAPP_BOT_URL)
//   dialog360 — emit the JSON envelope below to the system that owns our
//               360dialog number and performs the actual delivery
import { config } from '../env.js';

// Normalize a phone to digits with country code (Israeli 0-prefix -> 972).
export function normalizePhone(raw) {
  let p = String(raw || '').replace(/[^\d]/g, '');
  if (p.startsWith('00')) p = p.slice(2);
  if (p.startsWith('0')) p = '972' + p.slice(1);
  return p.length >= 8 && p.length <= 15 ? p : '';
}

// --------------------------------------------------- the 360dialog protocol --
// We do not talk to 360dialog ourselves. We hand a JSON envelope to the system
// that holds the number, and it performs the send. Everything that system needs
// in order to act — and to route the reply back to us — is in the envelope, so
// the contract is this shape and nothing implicit.
//
//   POST <DIALOG360_EXECUTOR_URL>
//   Authorization: Bearer <DIALOG360_EXECUTOR_TOKEN>
//   Content-Type: application/json
//
//   {
//     "protocol": "allaroundme.wa.v1",
//     "channel": "whatsapp",
//     "from": "<the 360dialog number under system control>",
//     "to": "972501234567",
//     "purpose": "verification" | "questionnaire" | "digest" | "system",
//     "message": { "type": "text", "text": "..." },
//     "context": { "kind": "otp", "run_id": null },
//     "reply_to": { "method": "POST", "url": "<PUBLIC_URL>/api/hooks/wa-inbound",
//                   "body": { "from": "<sender msisdn>", "text": "<message text>",
//                             "secret": "<DIALOG360_INBOUND_SECRET>" } },
//     "sent_at": "2026-07-17T09:00:00.000Z"
//   }
//
// A 2xx means "accepted for delivery". Anything else throws, and the caller
// decides whether to retry — this module never retries on its own.
export function buildDialog360Envelope(to, text, meta = {}) {
  const publicUrl = String(config.publicUrl || '').replace(/\/$/, '');
  return {
    protocol: 'allaroundme.wa.v1',
    channel: 'whatsapp',
    from: config.dialog360.number || null,
    to,
    purpose: meta.purpose || meta.kind || 'system',
    message: { type: 'text', text },
    context: { kind: meta.kind || 'system', run_id: meta.run_id ?? null },
    reply_to: {
      method: 'POST',
      url: `${publicUrl}/api/hooks/wa-inbound`,
      body: { from: '<sender msisdn>', text: '<message text>', secret: config.dialog360.inboundSecret || null },
    },
    sent_at: new Date().toISOString(),
  };
}

export async function transportSend(to, text, meta = {}) {
  const { mode, token, phoneId, botUrl } = config.whatsapp;

  if (mode === 'cloud' && token && phoneId) {
    const r = await fetch(`https://graph.facebook.com/v19.0/${phoneId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`cloud API ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return 'cloud';
  }

  if (mode === 'dialog360' && config.dialog360.executorUrl) {
    const headers = { 'Content-Type': 'application/json' };
    if (config.dialog360.executorToken) headers.Authorization = `Bearer ${config.dialog360.executorToken}`;
    const r = await fetch(config.dialog360.executorUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildDialog360Envelope(to, text, meta)),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`360dialog executor ${r.status}: ${(await r.text()).slice(0, 200)}`);
    return 'dialog360';
  }

  if (mode === 'webhook' && botUrl) {
    const r = await fetch(botUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, text, ...meta }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!r.ok) throw new Error(`bot webhook ${r.status}`);
    return 'webhook';
  }

  // A mode that was *asked for* but cannot run is a failure, not a fallback.
  // Silently printing instead would be the worst outcome available: the caller
  // reads 'log' as "delivered", the PHI hand-off then stamps the run delivered
  // and purges the patient's identifiers — so the answers never reach the
  // doctor, can never be retried, and sit verbatim in the log, which is the one
  // place this design says they must never be. Fail loudly and keep the data.
  if (mode !== 'log') {
    throw new Error(`whatsapp mode '${mode}' is selected but not configured — refusing to fall back to log`);
  }

  console.log(`[allaroundme] [wa:log] -> ${to}\n${text.split('\n').map((l) => '    ' + l).join('\n')}`);
  return 'log';
}
