/**
 * Pochettes et album d'un morceau.
 *
 * 1. Spotify, via le relais personnel (les identifiants développeur restent
 *    sur le relais, jamais dans l'app) ;
 * 2. sinon, l'API publique iTunes Search d'Apple (gratuite, sans clé).
 *
 * Un résultat n'est retenu que si l'artiste ET le titre correspondent à ce
 * que la radio ou Shazam a annoncé : jamais de pochette « au hasard ».
 */
import * as db from '../../core/db';
import { fold } from '../m3u/normalize';

export type ArtworkProvider = 'spotify' | 'itunes';

export interface Artwork {
  artworkUrl: string;
  album?: string;
  provider: ArtworkProvider;
  /** Lien vers le morceau (Spotify ou Apple Music). */
  url?: string;
}

const memory = new Map<string, Artwork | null>();

const simplify = (s: string) =>
  fold(s.replace(/\s*[([].*?[)\]]\s*/g, ' ').replace(/\b(feat|ft|featuring|avec|with)\b.*$/i, ''))
    .replace(/\bthe\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const close = (a: string, b: string) => {
  const x = simplify(a);
  const y = simplify(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};

/** « Artiste & Autre », « Artiste, Autre », « Artiste x Autre » : un des artistes suffit. */
const artistMatches = (candidates: string[], wanted: string) =>
  candidates.some((c) => close(c, wanted)) || wanted.split(/\s*(?:&|,|\bx\b|\band\b|\bet\b)\s*/i).some((part) => candidates.some((c) => close(c, part)));

async function fromSpotify(relayUrl: string, artist: string, title: string): Promise<Artwork | null | 'unavailable'> {
  try {
    const res = await fetch(`${relayUrl.replace(/\/+$/, '')}/cover?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(simplify(title) || title)}`, { credentials: 'omit' });
    if (res.status === 501) return 'unavailable'; // identifiants Spotify non configurés sur le relais
    if (!res.ok) return 'unavailable';
    const { results } = (await res.json()) as { results: { title: string; artists: string[]; album?: string; image: string; url?: string }[] };
    const hit = results.find((r) => artistMatches(r.artists, artist) && close(r.title, title));
    return hit ? { artworkUrl: hit.image, album: hit.album, provider: 'spotify', url: hit.url } : null;
  } catch {
    return 'unavailable';
  }
}

interface ItunesResult {
  artistName: string;
  trackName: string;
  collectionName?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
}

async function fromItunes(artist: string, title: string): Promise<Artwork | null | 'unavailable'> {
  try {
    const term = encodeURIComponent(`${simplify(artist)} ${simplify(title)}`);
    const res = await fetch(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=10`, { credentials: 'omit' });
    if (!res.ok) return 'unavailable';
    const json = (await res.json()) as { results: ItunesResult[] };
    const hit = json.results.find((r) => artistMatches([r.artistName], artist) && close(r.trackName, title));
    return hit?.artworkUrl100
      ? {
          artworkUrl: hit.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.'),
          album: hit.collectionName?.replace(/ - (Single|EP)$/, ''),
          provider: 'itunes',
          url: hit.trackViewUrl,
        }
      : null;
  } catch {
    return 'unavailable';
  }
}

export async function findArtwork(artist: string | undefined, title: string, opts: { relayUrl?: string } = {}): Promise<Artwork | null> {
  if (!artist || !title) return null;
  const providers: ArtworkProvider[] = opts.relayUrl ? ['spotify', 'itunes'] : ['itunes'];
  const key = `art2:${providers.join('+')}:${simplify(artist)}|${simplify(title)}`;
  if (memory.has(key)) return memory.get(key)!;
  const cached = await db.get<{ value: Artwork | null; at: number }>('kv', key).catch(() => undefined);
  if (cached && (cached.value || Date.now() - cached.at < 7 * 86400_000)) {
    memory.set(key, cached.value);
    return cached.value;
  }
  let found: Artwork | null = null;
  let reliable = true; // un échec réseau ne doit pas être mis en cache comme « introuvable »
  for (const p of providers) {
    const r = p === 'spotify' ? await fromSpotify(opts.relayUrl!, artist, title) : await fromItunes(artist, title);
    if (r === 'unavailable') {
      reliable = p === 'spotify' && reliable; // Spotify non configuré : on retombe simplement sur iTunes
      continue;
    }
    if (r) {
      found = r;
      break;
    }
  }
  if (!found && !reliable) return null;
  memory.set(key, found);
  db.put('kv', { value: found, at: Date.now() }, key).catch(() => {});
  return found;
}
