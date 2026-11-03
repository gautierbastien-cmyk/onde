/**
 * Relais personnel facultatif (Cloudflare Worker gratuit, voir /worker).
 * Le relais lit les métadonnées ICY côté serveur, là où le CORS ne s'applique
 * pas, et ne renvoie que le titre. Aucun identifiant n'est exposé.
 */
import { isMeaningful, splitStreamTitle } from '../streamTitle';
import { sleep, type MetadataProvider } from '../types';

export const relayMetaUrl = (relay: string, stream: string) => `${relay.replace(/\/+$/, '')}/meta?url=${encodeURIComponent(stream)}`;

export const relayProvider: MetadataProvider = {
  id: 'proxy',
  label: 'Relais personnel',
  accepts: (s, { relayUrl }) => !!relayUrl && !s.isHls,
  async start({ station, relayUrl, signal, emit }) {
    const read = async () => {
      const res = await fetch(relayMetaUrl(relayUrl, station.url), { signal, cache: 'no-store' });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = (await res.json()) as { streamTitle?: string; streamUrl?: string; error?: string };
      if (data.error) throw new Error(data.error);
      if (!isMeaningful(data.streamTitle, station.name)) return true;
      const { artist, title } = splitStreamTitle(data.streamTitle!);
      if (isMeaningful(title, station.name)) emit({ title, artist, raw: data.streamTitle!, source: 'proxy' });
      return true;
    };
    try {
      await read();
    } catch {
      return 'unsupported';
    }
    (async () => {
      while (!signal.aborted) {
        await sleep(15_000, signal);
        if (!signal.aborted) await read().catch(() => {});
      }
    })();
    return 'active';
  },
};
