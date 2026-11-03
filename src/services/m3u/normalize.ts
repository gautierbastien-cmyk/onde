/**
 * Normalisation des entrées : validation d'URL, identifiant stable,
 * pays, genres et nom affiché.
 */
import type { M3UEntry } from './parser';

export type UrlCheck = { ok: true; url: string } | { ok: false; reason: string };

export function validateUrl(raw: string): UrlCheck {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return { ok: false, reason: 'URL illisible' };
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    return { ok: false, reason: `Protocole ${u.protocol.replace(':', '')} non pris en charge par Safari` };
  }
  if (/\.(pls|asx|xspf|wax|ram)(?:$|\?)/i.test(u.pathname)) {
    return { ok: false, reason: 'Liste de lecture imbriquée (.pls/.asx) : utiliser l’URL directe du flux' };
  }
  return { ok: true, url: u.href };
}

/** URL normalisée pour la détection des doublons. */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.hostname = u.hostname.toLowerCase();
    if ((u.protocol === 'http:' && u.port === '80') || (u.protocol === 'https:' && u.port === '443')) u.port = '';
    let s = u.href;
    if (s.endsWith('/') && u.pathname !== '/') s = s.slice(0, -1);
    return s.replace(/^https?:\/\//, '');
  } catch {
    return url.trim();
  }
}

/** Hachage FNV-1a 32 bits, suffisant pour des identifiants locaux. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export const stationId = (url: string) => 's_' + hash(normalizeUrl(url)) + normalizeUrl(url).length.toString(36);

// ——— Pays ———

let regionIndex: Map<string, string> | null = null;

/** Index « nom de pays (fr/en, sans accents) → code ISO », construit avec Intl. */
function regions(): Map<string, string> {
  if (regionIndex) return regionIndex;
  regionIndex = new Map();
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const names = ['fr', 'en', 'es', 'de', 'it', 'pt'].map((l) => {
    try {
      return new Intl.DisplayNames([l], { type: 'region' });
    } catch {
      return null;
    }
  });
  for (const a of letters)
    for (const b of letters) {
      const code = a + b;
      for (const dn of names) {
        const n = dn?.of(code);
        if (n && n !== code) regionIndex.set(fold(n), code);
      }
    }
  // Variantes fréquentes dans les playlists
  for (const [k, v] of Object.entries({ uk: 'GB', usa: 'US', 'etats unis': 'US', angleterre: 'GB', holland: 'NL', suisse: 'CH', belgique: 'BE' }))
    regionIndex.set(k, v);
  return regionIndex;
}

export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

const isValidRegion = (code: string) => {
  try {
    const n = new Intl.DisplayNames(['en'], { type: 'region' }).of(code);
    return !!n && n !== code;
  } catch {
    return false;
  }
};

export function detectCountry(entry: M3UEntry): string | undefined {
  const a = entry.attrs;
  const candidates: string[] = [];
  if (a['tvg-country']) candidates.push(...a['tvg-country'].split(/[;,|\s]+/));
  if (a['country']) candidates.push(a['country']);
  for (const c of candidates) {
    const code = c.trim().toUpperCase();
    if (code === 'UK') return 'GB';
    if (/^[A-Z]{2}$/.test(code) && isValidRegion(code)) return code;
    const byName = regions().get(fold(c));
    if (byName) return byName;
  }
  // tvg-id « NomStation.fr@HD » (format iptv-org)
  const id = /\.([a-z]{2})(?:@|$)/i.exec(a['tvg-id'] ?? '');
  if (id && isValidRegion(id[1].toUpperCase())) return id[1].toUpperCase();
  // Préfixe dans le nom : « |FR| », « FR: », « [FR] », « FR | »
  const prefix = /^\s*(?:\|([A-Z]{2})\||\[([A-Z]{2})\]|([A-Z]{2})\s*[:|-]\s)/.exec(entry.name);
  const p = prefix?.[1] ?? prefix?.[2] ?? prefix?.[3];
  if (p && isValidRegion(p === 'UK' ? 'GB' : p)) return p === 'UK' ? 'GB' : p;
  // Groupe : « Radios France », « Jazz | Belgique »…
  const group = a['group-title'] ?? entry.group ?? '';
  for (const part of group.split(/[;|/,\-–]+/)) {
    const f = fold(part).replace(/^(radios?|webradios?|stations?)\s+/, '');
    const code = regions().get(f);
    if (code) return code;
  }
  return undefined;
}

// ——— Genres et nom ———

const NOT_GENRES = /^(radios?|webradios?|web radios?|stations?|audio|music|musique|undefined|other|others|autres?|general|général|divers|misc|all|toutes?|favoris?|favorites?|live|fm|am|[a-z]{2})$/i;

export function detectGenres(entry: M3UEntry, country?: string): string[] {
  const a = entry.attrs;
  const raw = [a['tvg-genre'], a['genre'], a['group-title'] ?? entry.group].filter(Boolean).join(';');
  const out = new Set<string>();
  for (const part of raw.split(/[;|/,]+/)) {
    let g = part
      .replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D]/gu, '')
      .replace(/^\s*(radios?|webradios?)\s+/i, '')
      .trim();
    if (!g || NOT_GENRES.test(g)) continue;
    if (country && regions().get(fold(g)) === country) continue; // le groupe est un pays
    if (regions().has(fold(g))) continue;
    g = g.charAt(0).toLocaleUpperCase('fr') + g.slice(1);
    out.add(g);
  }
  return [...out].slice(0, 4);
}

export function displayName(entry: M3UEntry, url: string): string {
  const name = (entry.name || entry.attrs['tvg-name'] || '')
    .replace(/^\s*(?:\|[A-Z]{2}\||\[[A-Z]{2}\]|[A-Z]{2}\s*[:|]\s)/, '')
    .replace(/\s+/g, ' ')
    .replace(/^[\s.\-_*~|]+|[\s.\-_*~|]+$/g, '')
    .trim();
  if (name) return name;
  try {
    const u = new URL(url);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return last ? `${u.hostname} · ${decodeURIComponent(last)}` : u.hostname;
  } catch {
    return url;
  }
}
