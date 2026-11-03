/**
 * Page d'état JSON d'Icecast (/status-json.xsl), quand elle est publique et
 * servie avec CORS. Utile si l'en-tête Icy-MetaData est refusé.
 */
import { isMeaningful, splitStreamTitle } from '../streamTitle';
import { sleep, type MetadataProvider } from '../types';

interface IcecastSource {
  listenurl?: string;
  title?: string;
  artist?: string;
  yp_currently_playing?: string;
}

async function fetchSource(streamUrl: string, signal: AbortSignal): Promise<IcecastSource | null> {
  const u = new URL(streamUrl);
  const res = await fetch(`${u.origin}/status-json.xsl`, { signal, cache: 'no-store', credentials: 'omit' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const json = await res.json();
  const src = json?.icestats?.source;
  const list: IcecastSource[] = Array.isArray(src) ? src : src ? [src] : [];
  return list.find((s) => s.listenurl && new URL(s.listenurl).pathname === u.pathname) ?? (list.length === 1 ? list[0] : null);
}

export const icecastStatusProvider: MetadataProvider = {
  id: 'icecast-status',
  label: 'Page d’état Icecast',
  accepts: (s) => !s.isHls,
  async start({ station, url, signal, emit }) {
    if (location.protocol === 'https:' && url.startsWith('http:')) return 'unsupported';
    const read = async () => {
      const s = await fetchSource(station.url, signal);
      const raw = s?.yp_currently_playing || [s?.artist, s?.title].filter(Boolean).join(' - ') || s?.title || '';
      if (!isMeaningful(raw, station.name)) return;
      const split = s?.artist && s.title ? { artist: s.artist, title: s.title } : splitStreamTitle(raw);
      if (!isMeaningful(split.title, station.name)) return;
      emit({ title: split.title, artist: split.artist, raw, source: 'icecast-status' });
    };
    try {
      const s = await fetchSource(station.url, signal);
      if (!s) return 'unsupported';
      await read();
    } catch {
      return 'unsupported';
    }
    (async () => {
      while (!signal.aborted) {
        await sleep(20_000, signal);
        if (!signal.aborted) await read().catch(() => {});
      }
    })();
    return 'active';
  },
};
