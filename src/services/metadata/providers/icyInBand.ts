/**
 * Métadonnées ICY lues directement dans le flux, depuis le navigateur.
 *
 * Possible uniquement si le serveur autorise le CORS et l'en-tête
 * « Icy-MetaData » (cas de nombreux Icecast récents).
 *
 * Deux régimes, pour ménager la bande passante :
 * - interrogation : toutes les 15 s, on se connecte, on lit le premier bloc
 *   de métadonnées (quelques dizaines de Ko) et on coupe ;
 * - continu : certains serveurs (Shoutcast notamment) envoient un titre vide
 *   à chaque nouvelle connexion. On garde alors une connexion ouverte qui lit
 *   chaque bloc, au prix d'un second flux tant que la radio joue.
 */
import { decodeText, isMeaningful, parseIcyBlock, splitStreamTitle, type IcyFields } from '../streamTitle';
import { sleep, type MetadataProvider } from '../types';

const POLL_MS = 15_000;
const MAX_SCAN = 256 * 1024;
const NEEDLE = [83, 116, 114, 101, 97, 109, 84, 105, 116, 108, 101, 61, 39]; // StreamTitle='

function indexOfNeedle(buf: Uint8Array, from = 0): number {
  outer: for (let i = from; i <= buf.length - NEEDLE.length; i++) {
    for (let j = 0; j < NEEDLE.length; j++) if (buf[i + j] !== NEEDLE[j]) continue outer;
    return i;
  }
  return -1;
}

const concat = (a: Uint8Array, b: Uint8Array) => {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
};

/**
 * Ouvre le flux et produit chaque bloc de métadonnées non vide.
 * Si icy-metaint n'est pas lisible (en-tête non exposé par le CORS), on le
 * déduit de la position du premier bloc : il suit exactement metaint octets audio.
 */
async function* icyBlocks(url: string, signal: AbortSignal): AsyncGenerator<IcyFields> {
  const res = await fetch(url, { headers: { 'Icy-MetaData': '1' }, signal, cache: 'no-store', credentials: 'omit' });
  if (!res.ok || !res.body) throw new Error('HTTP ' + res.status);
  let metaint = Number(res.headers.get('icy-metaint')) || 0;
  const reader = res.body.getReader();
  let pending: Uint8Array = new Uint8Array(0);
  let audioLeft = metaint;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done || !value) return;
      pending = concat(pending, value);

      if (!metaint) {
        const at = indexOfNeedle(pending);
        if (at < 1) {
          if (pending.length > MAX_SCAN) throw new Error('no-metadata');
          continue;
        }
        metaint = at - 1;
        audioLeft = metaint;
      }

      while (true) {
        if (audioLeft > 0) {
          const skip = Math.min(audioLeft, pending.length);
          pending = pending.subarray(skip);
          audioLeft -= skip;
          if (audioLeft > 0) break;
        }
        if (!pending.length) break;
        const len = pending[0] * 16;
        if (pending.length < 1 + len) break;
        const block = pending.subarray(1, 1 + len);
        pending = pending.subarray(1 + len);
        audioLeft = metaint;
        if (len) yield parseIcyBlock(decodeText(block));
      }
    }
  } finally {
    reader.cancel().catch(() => {});
  }
}

/** Premier bloc d'une connexion (régime « interrogation »). */
async function readFirst(url: string, signal: AbortSignal): Promise<IcyFields | null> {
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 10_000);
  try {
    for await (const f of icyBlocks(url, ctrl.signal)) return f;
    return null;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    ctrl.abort();
  }
}

export const icyInBandProvider: MetadataProvider = {
  id: 'icy',
  label: 'Métadonnées ICY du flux',
  accepts: (s) => !s.isHls,
  async start({ station, url, signal, emit }) {
    if (location.protocol === 'https:' && url.startsWith('http:')) return 'unsupported';

    const handle = (f: IcyFields | null) => {
      if (!f?.streamTitle || !isMeaningful(f.streamTitle, station.name)) return false;
      const { artist, title } = splitStreamTitle(f.streamTitle);
      if (!isMeaningful(title, station.name)) return false;
      const art = f.streamUrl && /\.(jpe?g|png|webp)(\?|$)/i.test(f.streamUrl) ? f.streamUrl : undefined;
      emit({ title, artist: isMeaningful(artist) ? artist : undefined, artworkUrl: art, raw: f.streamTitle, source: 'icy' });
      return true;
    };

    let first: IcyFields | null;
    try {
      first = await readFirst(url, signal);
    } catch {
      return 'unsupported'; // CORS refusé, en-tête interdit, pas de métadonnées ou serveur injoignable
    }
    if (!first) return 'unsupported';
    const continuous = first.streamTitle === undefined || first.streamTitle === '';
    handle(first);

    (async () => {
      let failures = 0;
      while (!signal.aborted) {
        try {
          if (continuous) {
            for await (const f of icyBlocks(url, signal)) {
              handle(f);
              failures = 0;
            }
          } else {
            await sleep(POLL_MS, signal);
            if (!signal.aborted) handle(await readFirst(url, signal));
            failures = 0;
          }
        } catch {
          if (signal.aborted) return;
          failures++;
        }
        if (continuous || failures) await sleep(Math.min(60_000, 3000 * 2 ** failures), signal);
      }
    })();
    return 'active';
  },
};
