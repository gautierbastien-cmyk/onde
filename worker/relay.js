/**
 * Relais personnel d'Onde — Cloudflare Worker (offre gratuite).
 *
 *   GET /health                 → { ok: true }
 *   GET /meta?url=<flux>        → { streamTitle, streamUrl } lus dans les métadonnées ICY
 *   GET /stream?url=<flux>      → le flux audio, servi en HTTPS avec CORS
 *   POST /shazam                → transmet une empreinte {uri, samplems, timezone} à Shazam
 *
 * Aucune donnée n'est stockée. ALLOWED_ORIGIN limite l'usage à votre app.
 */
const ALLOWED_ORIGIN = '*'; // ex. 'https://gautierbastien-cmyk.github.io'

const cors = { 'Access-Control-Allow-Origin': ALLOWED_ORIGIN, 'Access-Control-Allow-Headers': 'Content-Type, Range', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

async function shazam(request) {
  const payload = await request.json();
  if (!String(payload.uri || '').startsWith('data:audio/vnd.shazam.sig;base64,')) return json({ error: 'empreinte invalide' }, 400);
  const now = Date.now();
  const url = `https://amp.shazam.com/discovery/v5/fr/FR/android/-/tag/${crypto.randomUUID().toUpperCase()}/${crypto.randomUUID()}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&video=v3`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 5.0.2; VS980 4G Build/LRX22G)', 'Content-Language': 'fr_FR' },
    body: JSON.stringify({
      geolocation: { altitude: 300, latitude: 45, longitude: 2 },
      signature: { samplems: Math.round(payload.samplems), timestamp: now, uri: payload.uri },
      timestamp: now,
      timezone: payload.timezone || 'Europe/Paris',
    }),
  });
  if (!res.ok) return json({ error: `Shazam HTTP ${res.status}` }, 502);
  return json(await res.json());
}
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'content-type': 'application/json', 'cache-control': 'no-store' } });

function target(request) {
  const raw = new URL(request.url).searchParams.get('url');
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

async function readMeta(url) {
  const res = await fetch(url, { headers: { 'Icy-MetaData': '1', 'User-Agent': 'Onde/1.0' } });
  const metaint = Number(res.headers.get('icy-metaint')) || 0;
  if (!metaint || !res.body) return { error: 'no-metadata' };
  const reader = res.body.getReader();
  let buf = new Uint8Array(0);
  let audioLeft = metaint;
  try {
    while (buf.length < 512 * 1024) {
      const { value, done } = await reader.read();
      if (done) break;
      const next = new Uint8Array(buf.length + value.length);
      next.set(buf);
      next.set(value, buf.length);
      buf = next;
      while (true) {
        if (audioLeft > 0) {
          const skip = Math.min(audioLeft, buf.length);
          buf = buf.subarray(skip);
          audioLeft -= skip;
          if (audioLeft > 0) break;
        }
        if (!buf.length) break;
        const len = buf[0] * 16;
        if (buf.length < 1 + len) break;
        const text = new TextDecoder('utf-8').decode(buf.subarray(1, 1 + len));
        buf = buf.subarray(1 + len);
        audioLeft = metaint;
        const title = /StreamTitle='([\s\S]*?)';/.exec(text);
        // Un bloc vide signifie « pas de changement » : on attend le suivant (titre vide à la connexion sur Shoutcast).
        if (title && title[1].trim()) {
          const su = /StreamUrl='([\s\S]*?)';/.exec(text);
          return { streamTitle: title[1].trim(), streamUrl: su ? su[1] : undefined };
        }
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  return { streamTitle: '' };
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    const path = new URL(request.url).pathname;
    if (path === '/health') return json({ ok: true });
    if (path === '/shazam' && request.method === 'POST') return shazam(request);
    const url = target(request);
    if (!url) return json({ error: 'url manquante ou invalide' }, 400);
    if (path === '/meta') {
      try {
        return json(await readMeta(url));
      } catch (e) {
        return json({ error: String(e) }, 502);
      }
    }
    if (path === '/stream') {
      const upstream = await fetch(url, { headers: { 'User-Agent': 'Onde/1.0', ...(request.headers.get('range') ? { Range: request.headers.get('range') } : {}) } });
      const headers = new Headers(cors);
      for (const h of ['content-type', 'icy-br', 'icy-name']) if (upstream.headers.get(h)) headers.set(h, upstream.headers.get(h));
      headers.set('cache-control', 'no-store');
      return new Response(upstream.body, { status: upstream.status, headers });
    }
    return json({ error: 'route inconnue' }, 404);
  },
};
