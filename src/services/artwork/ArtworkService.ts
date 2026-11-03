/**
 * Pochettes et album via l'API publique iTunes Search d'Apple :
 * gratuite, sans clé, sans compte, servie avec CORS.
 *
 * Un résultat n'est retenu que si l'artiste ET le titre correspondent à ce
 * que la radio a annoncé : on n'affiche jamais une pochette « au hasard ».
 */
import * as db from '../../core/db';
import { fold } from '../m3u/normalize';

export interface Artwork {
  artworkUrl: string;
  album?: string;
  appleMusicUrl?: string;
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

interface ItunesResult {
  artistName: string;
  trackName: string;
  collectionName?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
}

export async function findArtwork(artist: string | undefined, title: string): Promise<Artwork | null> {
  if (!artist || !title) return null;
  const key = `art:${simplify(artist)}|${simplify(title)}`;
  if (memory.has(key)) return memory.get(key)!;
  const cached = await db.get<{ value: Artwork | null; at: number }>('kv', key).catch(() => undefined);
  if (cached && (cached.value || Date.now() - cached.at < 7 * 86400_000)) {
    memory.set(key, cached.value);
    return cached.value;
  }
  let found: Artwork | null = null;
  try {
    const term = encodeURIComponent(`${simplify(artist)} ${simplify(title)}`);
    const res = await fetch(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=10`, { credentials: 'omit' });
    if (!res.ok) return null; // erreur réseau / limite : pas de mise en cache
    const json = (await res.json()) as { results: ItunesResult[] };
    const hit = json.results.find((r) => close(r.artistName, artist) && close(r.trackName, title));
    if (hit?.artworkUrl100) {
      found = {
        artworkUrl: hit.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.'),
        album: hit.collectionName?.replace(/ - (Single|EP)$/, ''),
        appleMusicUrl: hit.trackViewUrl,
      };
    }
  } catch {
    return null;
  }
  memory.set(key, found);
  db.put('kv', { value: found, at: Date.now() }, key).catch(() => {});
  return found;
}
