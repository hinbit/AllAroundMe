// Streaming request to the Eshkolot alphon.
//
// ESHKOLOT_API_URL may be either the alphon's local port on the same VPS
// (http://127.0.0.1:3070/api — the normal Multidev companion setup) or its
// public origin (https://eshkolot.seach.co.il/api). Node's `http` and `https`
// modules are separate and `http.request` throws ERR_INVALID_PROTOCOL on an
// https URL, so pick the module from the target protocol.
import http from 'http';
import https from 'https';

export function upstreamRequest(target, options, onResponse) {
  const mod = target.protocol === 'https:' ? https : http;
  return mod.request(target, options, onResponse);
}

// Headers for an upstream hop: the Host must match the target (a public origin
// routes by Host and needs the right SNI), and we drop hop-by-hop headers that
// belong to the client<->us connection rather than us<->alphon. The body is
// relayed byte-for-byte, so content-length is left alone.
export function upstreamHeaders(reqHeaders, target) {
  const headers = { ...reqHeaders, host: target.host };
  delete headers['accept-encoding'];   // we relay the body verbatim, so no upstream compression
  delete headers.connection;
  return headers;
}
