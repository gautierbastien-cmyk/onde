/**
 * Vérification réseau d'un flux : audio, vidéo ou injoignable.
 *
 * 1. Requête CORS : type MIME, en-têtes ICY, et pour le HLS lecture de la
 *    playlist maîtresse (RESOLUTION / CODECS).
 * 2. Si le serveur refuse le CORS : sonde média. Un élément <video> charge
 *    les métadonnées sans CORS ; videoWidth > 0 révèle une piste vidéo.
 */
import type { StreamKind } from '../../core/types';

export interface ProbeResult {
  kind: StreamKind | 'unreachable';
  via: 'headers' | 'hls' | 'media' | 'mixed-content' | 'none';
  detail?: string;
}

const VIDEO_CODECS = /(avc1|avc3|hvc1|hev1|av01|vp09|vp8|mp4v|dvh1|dvhe)/i;
const AUDIO_CODECS = /(mp4a|mp3|\.40\.|ac-3|ec-3|opus|flac|vorbis)/i;

function withTimeout(ms: number): { signal: AbortSignal; cancel: () => void } {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return { signal: ctrl.signal, cancel: () => (clearTimeout(t), ctrl.abort()) };
}

/** Lit au plus `max` octets d'une réponse puis coupe la connexion (flux infinis). */
async function readHead(res: Response, max = 64 * 1024): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (size < max) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const all = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) all.set(c.subarray(0, Math.min(c.length, size - o)), o), (o += c.length);
  return new TextDecoder('utf-8').decode(all);
}

/** Analyse le texte d'une playlist HLS. Exporté pour les tests. */
export function analyzeHls(text: string): { kind: StreamKind; nextVariant?: string; detail: string } {
  const lines = text.split(/\r?\n/);
  const variants = lines.filter((l) => l.startsWith('#EXT-X-STREAM-INF'));
  if (variants.length) {
    if (variants.some((v) => /RESOLUTION=/i.test(v) || VIDEO_CODECS.test(v))) return { kind: 'video', detail: 'variantes vidéo (RESOLUTION/CODECS)' };
    const withCodecs = variants.filter((v) => /CODECS=/i.test(v));
    if (withCodecs.length === variants.length && withCodecs.every((v) => AUDIO_CODECS.test(v)))
      return { kind: 'audio', detail: 'codecs audio uniquement' };
    const idx = lines.findIndex((l) => l.startsWith('#EXT-X-STREAM-INF'));
    const next = lines.slice(idx + 1).find((l) => l.trim() && !l.startsWith('#'));
    return { kind: 'unknown', nextVariant: next?.trim(), detail: 'codecs non déclarés' };
  }
  const segments = lines.filter((l) => l.trim() && !l.startsWith('#'));
  if (segments.length) {
    if (segments.every((s) => /\.(aac|mp3|m4a|ac3|ec3|opus)(\?|$)/i.test(s))) return { kind: 'audio', detail: 'segments audio' };
    if (segments.some((s) => /\.(mp4|m4v)(\?|$)/i.test(s))) return { kind: 'video', detail: 'segments vidéo' };
  }
  return { kind: 'unknown', detail: 'segments MPEG-TS ambigus' };
}

function mediaProbe(url: string, timeoutMs: number): Promise<ProbeResult> {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') return resolve({ kind: 'unknown', via: 'none' });
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.preload = 'metadata';
    let settled = false;
    const finish = (r: ProbeResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      v.removeAttribute('src');
      v.load();
      resolve(r);
    };
    const timer = setTimeout(() => finish({ kind: 'unknown', via: 'media', detail: 'délai dépassé' }), timeoutMs);
    v.addEventListener('loadedmetadata', () =>
      finish(v.videoWidth > 0 ? { kind: 'video', via: 'media', detail: `${v.videoWidth}×${v.videoHeight}` } : { kind: 'audio', via: 'media', detail: 'aucune piste vidéo' }),
    );
    v.addEventListener('error', () => finish({ kind: 'unreachable', via: 'media', detail: `erreur média ${v.error?.code ?? ''}` }));
    v.src = url;
    v.load();
  });
}

export async function probeStream(url: string, timeoutMs = 7000): Promise<ProbeResult> {
  if (typeof location !== 'undefined' && location.protocol === 'https:' && url.startsWith('http:')) {
    // Le lecteur tentera la version HTTPS : c'est elle qu'on vérifie.
    const r = await probeStream('https:' + url.slice(5), timeoutMs);
    return r.kind === 'unreachable' ? { kind: 'unknown', via: 'mixed-content', detail: 'flux uniquement en HTTP' } : r;
  }
  const t = withTimeout(timeoutMs);
  try {
    const res = await fetch(url, { signal: t.signal, cache: 'no-store', credentials: 'omit' });
    if (!res.ok) return { kind: 'unreachable', via: 'headers', detail: `HTTP ${res.status}` };
    const type = (res.headers.get('content-type') ?? '').toLowerCase();
    if (type.startsWith('video/') && !type.includes('mp2t')) return { kind: 'video', via: 'headers', detail: type };
    if (type.startsWith('audio/') && !type.includes('mpegurl')) return { kind: 'audio', via: 'headers', detail: type };
    if (res.headers.get('icy-name') || res.headers.get('icy-metaint') || res.headers.get('icy-br')) return { kind: 'audio', via: 'headers', detail: 'en-têtes ICY' };
    if (type.includes('mpegurl') || /\.m3u8(\?|$)/i.test(url)) {
      const text = await readHead(res);
      let r = analyzeHls(text);
      if (r.kind === 'unknown' && r.nextVariant) {
        const variant = new URL(r.nextVariant, res.url || url).href;
        const sub = await fetch(variant, { signal: t.signal, cache: 'no-store', credentials: 'omit' });
        r = analyzeHls(await readHead(sub));
      }
      if (r.kind !== 'unknown') return { kind: r.kind, via: 'hls', detail: r.detail };
    } else {
      res.body?.cancel().catch(() => {});
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') {
      // Délai dépassé côté fetch : on tente la sonde média.
    }
  } finally {
    t.cancel();
  }
  return mediaProbe(url, timeoutMs);
}
