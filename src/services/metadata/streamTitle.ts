/**
 * Fonctions pures autour des métadonnées ICY (Shoutcast/Icecast).
 *
 * Dans un flux ICY, après chaque bloc de `icy-metaint` octets audio vient un
 * octet de longueur L, puis L×16 octets de texte :
 *   StreamTitle='Artiste - Titre';StreamUrl='…';
 */

export interface IcyFields {
  streamTitle?: string;
  streamUrl?: string;
}

export interface SplitTitle {
  title: string;
  artist?: string;
}

/** Décodage UTF-8, avec repli Windows-1252 (encore très répandu en ICY). */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}

export function parseIcyBlock(text: string): IcyFields {
  const clean = text.replace(/\0+$/g, '');
  const out: IcyFields = {};
  // Le titre peut contenir des apostrophes : il se termine par « '; » suivi d'une autre clé, de NUL ou de la fin.
  const title = /StreamTitle='([\s\S]*?)';(?=\s*Stream[A-Za-z]+=|\s*$|\0)/.exec(clean) ?? /StreamTitle='([\s\S]*?)'?;?$/.exec(clean);
  if (title) out.streamTitle = title[1].trim();
  const url = /StreamUrl='([\s\S]*?)';/.exec(clean);
  if (url && url[1].trim()) out.streamUrl = url[1].trim();
  return out;
}

const SEPARATORS = [' - ', ' – ', ' — ', ' ~ ', ' | '];

/** Valeurs qui ne désignent pas un morceau : on ne les enregistre jamais. */
const JUNK = /^(|-|–|\.|unknown|inconnu|n\/a|null|undefined|untitled|sans titre|live|en direct|on air|advert|advertisement|publicit[eé]|pub|jingle|station id|\d+)$/i;

export function isMeaningful(s: string | undefined, stationName?: string): boolean {
  if (!s) return false;
  const v = s.trim();
  if (JUNK.test(v)) return false;
  if (/^https?:\/\//i.test(v)) return false;
  if (stationName && v.toLowerCase() === stationName.trim().toLowerCase()) return false;
  return true;
}

/** « Artiste - Titre » → { artist, title }. Sans séparateur : titre seul, sans artiste inventé. */
export function splitStreamTitle(raw: string): SplitTitle {
  const s = raw.replace(/\s+/g, ' ').trim();
  for (const sep of SEPARATORS) {
    const i = s.indexOf(sep);
    if (i > 0 && i < s.length - sep.length) {
      const artist = s.slice(0, i).trim();
      const title = s.slice(i + sep.length).trim();
      if (artist && title) return { artist, title };
    }
  }
  return { title: s };
}
