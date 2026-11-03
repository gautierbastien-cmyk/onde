/**
 * Lecture d'un guide des programmes XMLTV (url-tvg de la playlist).
 * Fonction pure : on ne garde que les programmes autour de « maintenant »,
 * sous forme compacte, pour un stockage léger dans IndexedDB.
 */

export interface Programme {
  start: number;
  end: number;
  title: string;
  desc?: string;
}

/** « 20261103180000 +0100 » → horodatage UTC (ms). */
export function parseXmltvDate(s: string): number {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-])?(\d{2})?(\d{2})?/.exec(s.trim());
  if (!m) return NaN;
  const [, y, mo, d, h, mi, sec = '00', sign, oh = '00', om = '00'] = m;
  const utc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec);
  const offset = sign ? (sign === '-' ? -1 : 1) * (+oh * 60 + +om) * 60_000 : 0;
  return utc - offset;
}

const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&amp;/g, '&')
    .trim();

/**
 * Bloc générique sans valeur (« Station – En direct » sur 24 h) : ce n'est
 * pas une émission, on ne l'affiche pas.
 */
export function isPlaceholder(title: string, start: number, end: number): boolean {
  return /[–-]\s*(en direct|live|direct)\s*$/i.test(title) || end - start >= 20 * 3600_000;
}

export function parseXmltv(xml: string, now = Date.now(), before = 2 * 3600_000, after = 36 * 3600_000): Record<string, Programme[]> {
  const out: Record<string, Programme[]> = {};
  const re = /<programme\b([^>]*)>([\s\S]*?)<\/programme>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const attrs = m[1];
    const channel = /channel="([^"]*)"/.exec(attrs)?.[1];
    const start = parseXmltvDate(/start="([^"]*)"/.exec(attrs)?.[1] ?? '');
    const end = parseXmltvDate(/stop="([^"]*)"/.exec(attrs)?.[1] ?? '');
    if (!channel || !(end > now - before) || !(start < now + after)) continue;
    const title = decode(/<title\b[^>]*>([\s\S]*?)<\/title>/.exec(m[2])?.[1] ?? '');
    if (!title || isPlaceholder(title, start, end)) continue;
    const desc = decode(/<desc\b[^>]*>([\s\S]*?)<\/desc>/.exec(m[2])?.[1] ?? '') || undefined;
    (out[channel] ??= []).push({ start, end, title, desc });
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.start - b.start);
  return out;
}

export function currentProgramme(list: Programme[] | undefined, now = Date.now()): Programme | undefined {
  return list?.find((p) => p.start <= now && now < p.end);
}
