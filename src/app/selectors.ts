/** Sélecteurs dérivés (mémoïsés sur la référence des données). */
import type { Playlist, Station, Track } from '../core/types';
import { fold } from '../services/m3u/normalize';
import { countryName } from '../i18n';
import type { AppState } from './state';

function memo<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  let lastArgs: A | null = null;
  let last: R;
  return (...a: A) => {
    if (lastArgs && a.length === lastArgs.length && a.every((x, i) => x === lastArgs![i])) return last;
    lastArgs = a;
    return (last = fn(...a));
  };
}

const _visible = memo((stations: Station[], hidden: string[]) => {
  if (!hidden.length) return stations;
  const h = new Set(hidden);
  return stations.filter((s) => !h.has(s.id));
});
export const visibleStations = (s: AppState) => _visible(s.stations, s.hidden);

export interface Facet {
  key: string;
  label: string;
  count: number;
  logos: string[];
  /** Emoji de la catégorie, tel que défini dans la playlist (group-title). */
  icon?: string;
}

const LEADING_EMOJI = /^([\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\u200D\u20E3]+)\s*/u;

/** « 🎷 Jazz, Soul & Funk » → { icon: '🎷', label: 'Jazz, Soul & Funk' } */
export function splitGroup(group: string): { icon?: string; label: string } {
  const m = LEADING_EMOJI.exec(group);
  return m ? { icon: m[1], label: group.slice(m[0].length).trim() || group } : { label: group };
}

const groupOf = (s: Station) => (s.attrs['group-title'] ?? '').trim() || 'Autres';

/**
 * Catégories de la playlist (group-title), dans l'ordre où elles apparaissent,
 * comme dans les lecteurs IPTV : rien n'est découpé ni renommé.
 */
const _categories = memo((playlists: Playlist[], byId: Map<string, Station>, hidden: string[]): Facet[] => {
  const h = new Set(hidden);
  const m = new Map<string, Facet>();
  const add = (s: Station) => {
    if (h.has(s.id)) return;
    const key = groupOf(s);
    let f = m.get(key);
    if (!f) m.set(key, (f = { key, ...splitGroup(key), count: 0, logos: [] }));
    f.count++;
    if (s.logo && f.logos.length < 3 && !f.logos.includes(s.logo)) f.logos.push(s.logo);
  };
  const seen = new Set<string>();
  for (const p of playlists)
    for (const id of p.stationIds) {
      const s = byId.get(id);
      if (s && !seen.has(id)) seen.add(id), add(s);
    }
  for (const s of byId.values()) if (!seen.has(s.id)) add(s);
  return [...m.values()];
});
export const categoryFacets = (s: AppState) => _categories(s.playlists, s.byId, s.hidden);


const _countries = memo((stations: Station[]): Facet[] => {
  const m = new Map<string, Facet>();
  for (const s of stations) {
    if (!s.country) continue;
    const f = m.get(s.country) ?? { key: s.country, label: countryName(s.country), count: 0, logos: [] };
    f.count++;
    if (s.logo && f.logos.length < 3) f.logos.push(s.logo);
    m.set(s.country, f);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'));
});
export const countryFacets = (s: AppState) => _countries(visibleStations(s));

const _index = memo((stations: Station[]) => stations.map((s) => [s, fold([s.name, s.genres.join(' '), s.country ? countryName(s.country) : '', s.country ?? ''].join(' '))] as const));

/** Recherche instantanée, insensible aux accents et à la casse ; tous les mots doivent correspondre. */
export function searchStations(stations: Station[], q: string): Station[] {
  const words = fold(q).split(' ').filter(Boolean);
  if (!words.length) return stations;
  const scored: [Station, number][] = [];
  for (const [s, text] of _index(stations)) {
    if (!words.every((w) => text.includes(w))) continue;
    const name = fold(s.name);
    scored.push([s, name.startsWith(words[0]) ? 0 : name.includes(words[0]) ? 1 : 2]);
  }
  return scored.sort((a, b) => a[1] - b[1]).map(([s]) => s);
}

export function searchTracks(tracks: Track[], q: string): Track[] {
  const words = fold(q).split(' ').filter(Boolean);
  if (!words.length) return tracks;
  return tracks.filter((t) => {
    const text = fold([t.title, t.artist, t.album, t.stationName].filter(Boolean).join(' '));
    return words.every((w) => text.includes(w));
  });
}

export function collection(s: AppState, kind: string, value: string): Station[] {
  const vis = visibleStations(s);
  switch (kind) {
    case 'group': {
      // Ordre de la playlist, comme dans la catégorie d'origine
      const order = new Map(s.playlists.flatMap((p) => p.stationIds).map((id, i) => [id, i] as const));
      return vis.filter((st) => groupOf(st) === value).sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9));
    }
    case 'genre':
      return vis.filter((st) => st.genres.some((g) => fold(g) === value));
    case 'country':
      return vis.filter((st) => st.country === value);
    case 'playlist': {
      const p = s.playlists.find((x) => x.id === value);
      return p ? (p.stationIds.map((id) => s.byId.get(id)).filter((x) => x && !s.hidden.includes(x.id)) as Station[]) : [];
    }
    case 'recents':
      return s.recents.map((r) => s.byId.get(r.stationId)).filter((x): x is Station => !!x && !s.hidden.includes(x.id));
    case 'hidden':
      return s.hidden.map((id) => s.byId.get(id)).filter((x): x is Station => !!x);
    default:
      return vis;
  }
}

/** Groupe l'historique par jour (fuseau local). */
export function groupByDay(tracks: Track[]): [string, Track[]][] {
  const out: [string, Track[]][] = [];
  let key = '';
  for (const t of tracks) {
    const k = new Date(t.identifiedAt).toDateString();
    if (k !== key) {
      out.push([k, []]);
      key = k;
    }
    out[out.length - 1][1].push(t);
  }
  return out;
}
