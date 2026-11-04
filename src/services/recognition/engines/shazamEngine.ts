/**
 * Moteur « Shazam » (non officiel) : capture ~12 s du flux, calcule
 * l'empreinte localement, puis interroge Shazam via le relais personnel
 * (le serveur de Shazam refuse les appels directs des navigateurs).
 *
 * Service non documenté : il peut cesser de fonctionner sans préavis.
 */
import type { RecognitionEngine, RecognitionResult } from '../MusicRecognitionService';
import { captureClip } from '../shazam/capture';
import { computeSignature, SAMPLE_RATE, signatureUri } from '../shazam/signature';

interface ShazamTrack {
  title?: string;
  subtitle?: string;
  images?: { coverart?: string; coverarthq?: string };
  sections?: { type?: string; metadata?: { title?: string; text?: string }[] }[];
}

interface ShazamMatch {
  offset?: number;
  timeskew?: number;
  frequencyskew?: number;
}

/** Au-delà, l'extrait ne colle pas vraiment au morceau (vitesse ou hauteur faussées) : on rejette. */
const MAX_SKEW = 0.03;

export function parseShazamResponse(json: { matches?: ShazamMatch[]; track?: ShazamTrack & { key?: string } }): (Omit<RecognitionResult, 'raw'> & { key?: string; appleId?: string }) | null {
  const t = json.track;
  const m = json.matches?.[0];
  if (!m || !t?.title) return null;
  if (Math.abs(m.timeskew ?? 0) > MAX_SKEW || Math.abs(m.frequencyskew ?? 0) > MAX_SKEW) return null;
  const album = t.sections?.flatMap((s) => s.metadata ?? []).find((m) => /album/i.test(m.title ?? ''))?.text;
  return {
    title: t.title,
    artist: t.subtitle || undefined,
    album: album || undefined,
    artworkUrl: t.images?.coverarthq || t.images?.coverart || undefined,
    source: 'recognition:shazam',
    confidence: 1,
    offsetMs: typeof m.offset === 'number' ? m.offset * 1000 : undefined,
    key: t.key ?? `${t.subtitle}|${t.title}`.toLowerCase(),
    appleId: /"type":"applemusicplay"[^}]*?"id":"(\d+)"|"id":"(\d{6,})"/.exec(JSON.stringify((t as any).hub ?? {}))?.slice(1).find(Boolean),
  };
}

/** Durée exacte via l'identifiant Apple Music renvoyé par Shazam (API iTunes Lookup). */
async function exactDuration(appleId?: string): Promise<number | undefined> {
  if (!appleId) return undefined;
  try {
    const res = await fetch(`https://itunes.apple.com/lookup?id=${appleId}`, { credentials: 'omit' });
    const json = (await res.json()) as { results?: { wrapperType?: string; trackTimeMillis?: number }[] };
    return json.results?.find((r) => r.wrapperType === 'track')?.trackTimeMillis;
  } catch {
    return undefined;
  }
}

export function shazamEngine(opts: { relayUrl: () => string; streamUrl: (url: string) => string }): RecognitionEngine {
  const relay = () => opts.relayUrl().replace(/\/+$/, '');
  return {
    id: 'shazam',
    label: 'Identifier avec Shazam',
    mode: 'on-demand',
    isAvailable: () => !!opts.relayUrl(),
    async identify({ station, signal }) {
      const direct = opts.streamUrl(station.url);
      // Le serveur envoie d'abord quelques secondes de tampon : l'extrait est un peu antérieur au direct.
      const capturedAt = Date.now() - 2000;
      let pcm: Int16Array;
      try {
        pcm = await captureClip(direct, { isHls: station.isHls, signal, seconds: 13 });
      } catch (e) {
        // Flux sans CORS : on le lit via le relais, qui ajoute les en-têtes nécessaires.
        if (signal.aborted || station.isHls) throw e;
        pcm = await captureClip(`${relay()}/stream?url=${encodeURIComponent(station.url)}`, { signal, seconds: 13 });
      }
      // Double vérification : deux fenêtres de 12 s (minimum exigé par Shazam) qui se chevauchent, interrogées en parallèle.
      // Le résultat n'est retenu que si les deux désignent le même morceau.
      const win = Math.min(pcm.length, SAMPLE_RATE * 12);
      const shift = pcm.length - win;
      const ask = async (part: Int16Array) => {
        const sig = computeSignature(part);
        const res = await fetch(`${relay()}/shazam`, {
          method: 'POST',
          signal,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            uri: signatureUri(sig),
            samplems: Math.round((sig.numberSamples / SAMPLE_RATE) * 1000),
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          }),
        });
        if (!res.ok) throw new Error('Relais : HTTP ' + res.status);
        return parseShazamResponse(await res.json());
      };
      const [a, b] = await Promise.all([ask(pcm.subarray(0, win)), ask(pcm.subarray(shift, shift + win))]);
      if (!a || !b || a.key !== b.key) return null;
      return { ...a, durationMs: await exactDuration(a.appleId), capturedAt, raw: [a.artist, a.title].filter(Boolean).join(' - ') };
    },
  };
}
