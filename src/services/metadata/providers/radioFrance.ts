/**
 * Radio France (FIP, France Inter, France Musique, Mouv…) : leurs flux
 * n'annoncent pas les titres, mais l'API publique « livemeta » le fait
 * (gratuite, sans clé, CORS ouvert). Seuls les éléments de type « song »
 * sont retenus : une émission n'est pas un morceau.
 */
import { isMeaningful } from '../streamTitle';
import { sleep, type MetadataProvider } from '../types';

const STATIONS: Record<string, number> = {
  franceinter: 1,
  francemusique: 4,
  franceculture: 5,
  mouv: 6,
  fip: 7,
  fiprock: 64,
  fipjazz: 65,
  fipgroove: 66,
  fipworld: 69,
  fipnouveautes: 70,
  fipreggae: 71,
  fipelectro: 74,
  fipmetal: 77,
  fippop: 78,
};

/** « icecast.radiofrance.fr/fipjazz-hifi.aac » ou « stream.radiofrance.fr/fip/fip.m3u8 » → identifiant livemeta. */
export function radioFranceId(streamUrl: string): number | undefined {
  try {
    const u = new URL(streamUrl);
    if (!/(^|\.)radiofrance\.fr$|(^|\.)fipradio\.fr$/.test(u.hostname)) return undefined;
    const first = u.pathname.split('/').filter(Boolean)[0] ?? '';
    const slug = first.replace(/[-_.](hifi|midfi|lofi|aac|mp3|m3u8).*$/i, '').replace(/[-_]/g, '').toLowerCase();
    return STATIONS[slug] ?? (u.pathname.startsWith('/live/') ? STATIONS[(u.pathname.split('/')[2] ?? '').replace(/-.*$/, '')] : undefined);
  } catch {
    return undefined;
  }
}

interface Step {
  title?: string;
  authors?: string;
  performers?: string;
  titreAlbum?: string;
  visual?: string;
  start: number;
  end: number;
  embedType?: string;
  depth?: number;
}

export const radioFranceProvider: MetadataProvider = {
  id: 'broadcaster',
  label: 'API Radio France',
  accepts: (s) => radioFranceId(s.url) !== undefined,
  async start({ station, signal, emit }) {
    const id = radioFranceId(station.url)!;
    const read = async (): Promise<number> => {
      const res = await fetch(`https://api.radiofrance.fr/livemeta/pull/${id}`, { signal, cache: 'no-store', credentials: 'omit' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = (await res.json()) as { steps?: Record<string, Step> };
      const now = Date.now() / 1000;
      const current = Object.values(data.steps ?? {})
        .filter((s) => s.start <= now && now <= s.end)
        .sort((a, b) => (b.depth ?? 0) - (a.depth ?? 0))[0];
      if (current?.embedType === 'song' && isMeaningful(current.title)) {
        const artist = current.performers || current.authors || undefined;
        emit({
          title: current.title!.charAt(0).toLocaleUpperCase('fr') + current.title!.slice(1),
          artist,
          album: current.titreAlbum || undefined,
          artworkUrl: current.visual || undefined,
          raw: [artist, current.title].filter(Boolean).join(' - '),
          source: 'broadcaster',
        });
      }
      // Prochaine lecture à la fin de l'élément en cours (bornée entre 10 s et 60 s).
      return Math.min(60, Math.max(10, (current?.end ?? now + 20) - now + 2)) * 1000;
    };
    let wait: number;
    try {
      wait = await read();
    } catch {
      return 'unsupported';
    }
    (async () => {
      while (!signal.aborted) {
        await sleep(wait, signal);
        if (signal.aborted) break;
        wait = await read().catch(() => 30_000);
      }
    })();
    return 'active';
  },
};
