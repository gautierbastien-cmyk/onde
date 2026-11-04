/**
 * Capture d'un extrait du flux radio, décodé en PCM mono 16 kHz.
 *
 * L'extrait est lu par une connexion séparée : la lecture en cours n'est ni
 * interrompue ni modifiée. Le décodage passe par une OfflineAudioContext à
 * 16 kHz (rééchantillonnage natif), sans rien router vers les haut-parleurs.
 */
import { SAMPLE_RATE } from './signature';
import { alignFrames, audioDuration } from './framing';
import { extractTsAudio, isMpegTs } from './mpegts';

export class CaptureError extends Error {}

async function readBytes(url: string, maxBytes: number, maxMs: number, signal: AbortSignal, seconds = Infinity): Promise<Uint8Array> {
  const res = await fetch(url, { signal, cache: 'no-store', credentials: 'omit' });
  if (!res.ok || !res.body) throw new CaptureError('HTTP ' + res.status);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const started = Date.now();
  let checkedAt = 0;
  try {
    while (size < maxBytes && Date.now() - started < maxMs) {
      const { value, done } = await reader.read();
      if (done || !value) break;
      chunks.push(value);
      size += value.length;
      // Dès que la durée reçue suffit, on arrête (les serveurs envoient souvent plusieurs secondes d'un coup).
      if (size - checkedAt >= 24_000) {
        checkedAt = size;
        const all = new Uint8Array(size);
        let o = 0;
        for (const c of chunks) all.set(c, o), (o += c.length);
        if (audioDuration(all) >= seconds) break;
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) out.set(c, o), (o += c.length);
  return out;
}

/** HLS : derniers segments audio de la variante la plus légère. */
async function readHls(url: string, seconds: number, signal: AbortSignal): Promise<Uint8Array> {
  let text = await (await fetch(url, { signal, cache: 'no-store' })).text();
  let base = url;
  if (text.includes('#EXT-X-STREAM-INF')) {
    const lines = text.split(/\r?\n/);
    const variants = lines
      .map((l, i) => (l.startsWith('#EXT-X-STREAM-INF') ? { bw: Number(/BANDWIDTH=(\d+)/.exec(l)?.[1] ?? 1e9), uri: lines[i + 1] } : null))
      .filter((v): v is { bw: number; uri: string } => !!v && !!v.uri);
    variants.sort((a, b) => a.bw - b.bw);
    base = new URL(variants[0].uri, url).href;
    text = await (await fetch(base, { signal, cache: 'no-store' })).text();
  }
  const segs: { dur: number; uri: string }[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^#EXTINF:([\d.]+)/.exec(lines[i]);
    if (m && lines[i + 1] && !lines[i + 1].startsWith('#')) segs.push({ dur: Number(m[1]), uri: new URL(lines[i + 1], base).href });
  }
  const picked: string[] = [];
  let total = 0;
  for (let i = segs.length - 1; i >= 0 && total < seconds + 1; i--) {
    picked.unshift(segs[i].uri);
    total += segs[i].dur;
  }
  if (!picked.length) throw new CaptureError('playlist HLS vide');
  const parts = await Promise.all(picked.map(async (u) => new Uint8Array(await (await fetch(u, { signal })).arrayBuffer())));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, o), (o += p.length);
  return out;
}

export async function captureClip(url: string, opts: { seconds?: number; isHls?: boolean; signal: AbortSignal }): Promise<Int16Array> {
  const seconds = opts.seconds ?? 12;
  // Débit inconnu : on lit au plus l'équivalent de 320 kb/s, ou 18 s de temps réel.
  const raw = opts.isHls ? await readHls(url, seconds, opts.signal) : await readBytes(url, Math.round((320_000 / 8) * (seconds + 2)), (seconds + 6) * 1000, opts.signal, seconds + 1.3);
  // Segments HLS en MPEG-TS : on en extrait la piste audio (AAC ou MP3).
  const audioOnly = isMpegTs(raw) ? extractTsAudio(raw) : raw;
  if (!audioOnly) throw new CaptureError('aucune piste audio dans le flux');
  const bytes = alignFrames(audioOnly);
  if (bytes.length < 16_000) throw new CaptureError('extrait trop court');

  const Ctx: typeof OfflineAudioContext = (window as any).OfflineAudioContext ?? (window as any).webkitOfflineAudioContext;
  const ctx = new Ctx(1, SAMPLE_RATE * seconds, SAMPLE_RATE);
  let audio: AudioBuffer;
  try {
    audio = await new Promise<AudioBuffer>((resolve, reject) => {
      const p = ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, resolve, reject);
      p?.then?.(resolve, reject);
    });
  } catch {
    throw new CaptureError('format audio non décodable');
  }
  // Mono, 16 bits, en sautant la première seconde (souvent tronquée).
  const skip = Math.min(SAMPLE_RATE, Math.max(0, audio.length - SAMPLE_RATE * seconds));
  const length = Math.min(audio.length - skip, SAMPLE_RATE * seconds);
  const pcm = new Int16Array(length);
  const channels = Array.from({ length: audio.numberOfChannels }, (_, c) => audio.getChannelData(c));
  for (let i = 0; i < length; i++) {
    let v = 0;
    for (const ch of channels) v += ch[skip + i];
    v /= channels.length;
    pcm[i] = Math.max(-32768, Math.min(32767, Math.round(v * 32767)));
  }
  if (length < SAMPLE_RATE * 4) throw new CaptureError('extrait trop court');
  return pcm;
}
