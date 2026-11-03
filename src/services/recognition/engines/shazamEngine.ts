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

export function parseShazamResponse(json: { matches?: unknown[]; track?: ShazamTrack }): Omit<RecognitionResult, 'raw'> | null {
  const t = json.track;
  if (!json.matches?.length || !t?.title) return null;
  const album = t.sections?.flatMap((s) => s.metadata ?? []).find((m) => /album/i.test(m.title ?? ''))?.text;
  return {
    title: t.title,
    artist: t.subtitle || undefined,
    album: album || undefined,
    artworkUrl: t.images?.coverarthq || t.images?.coverart || undefined,
    source: 'recognition:shazam',
    confidence: 1,
  };
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
      let pcm: Int16Array;
      try {
        pcm = await captureClip(direct, { isHls: station.isHls, signal });
      } catch (e) {
        // Flux sans CORS : on le lit via le relais, qui ajoute les en-têtes nécessaires.
        if (signal.aborted || station.isHls) throw e;
        pcm = await captureClip(`${relay()}/stream?url=${encodeURIComponent(station.url)}`, { signal });
      }
      const sig = computeSignature(pcm);
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
      const parsed = parseShazamResponse(await res.json());
      return parsed && { ...parsed, raw: [parsed.artist, parsed.title].filter(Boolean).join(' - ') };
    },
  };
}
