/**
 * Émission en cours d'une station.
 * Sources : guides XMLTV des playlists (url-tvg, associés par tvg-id) et
 * API publique Radio France (émission du moment, hors morceaux).
 * Rien n'est inventé : sans source fiable, aucune émission n'est affichée.
 */
import * as db from '../../core/db';
import type { Playlist, Station } from '../../core/types';
import { radioFranceId } from '../metadata/providers/radioFrance';
import { currentProgramme, parseXmltv, type Programme } from './xmltv';

export interface Show {
  title: string;
  desc?: string;
  start?: number;
  end?: number;
  source: 'epg' | 'radiofrance';
}

const EPG_MAX_AGE = 6 * 3600_000;
let guide: Record<string, Programme[]> = {};

interface CachedGuide {
  fetchedAt: number;
  data: Record<string, Programme[]>;
}

/** Charge les guides (cache IndexedDB, rafraîchi toutes les 6 h quand le réseau le permet). */
export async function loadGuides(playlists: Playlist[]): Promise<void> {
  const urls = [...new Set(playlists.map((p) => p.epgUrl).filter((u): u is string => !!u))];
  const merged: Record<string, Programme[]> = {};
  for (const url of urls) {
    const key = 'epg:' + url;
    let cached = await db.get<CachedGuide>('kv', key).catch(() => undefined);
    if (!cached || Date.now() - cached.fetchedAt > EPG_MAX_AGE) {
      try {
        const res = await fetch(url, { cache: 'no-store', credentials: 'omit' });
        if (res.ok) {
          cached = { fetchedAt: Date.now(), data: parseXmltv(await res.text()) };
          await db.put('kv', cached, key);
        }
      } catch {
        /* hors ligne : on garde l'ancien guide */
      }
    }
    if (cached) Object.assign(merged, cached.data);
  }
  guide = merged;
}

interface RfStep {
  title?: string;
  start: number;
  end: number;
  embedType?: string;
  depth?: number;
  titleConcept?: string;
}

const rfCache = new Map<number, { at: number; show: Show | null }>();

async function radioFranceShow(id: number): Promise<Show | null> {
  const hit = rfCache.get(id);
  if (hit && Date.now() - hit.at < 60_000) return hit.show;
  try {
    const res = await fetch(`https://api.radiofrance.fr/livemeta/pull/${id}`, { cache: 'no-store', credentials: 'omit' });
    const data = (await res.json()) as { steps?: Record<string, RfStep> };
    const now = Date.now() / 1000;
    // L'émission est l'élément « parent » (profondeur la plus faible) qui n'est pas un morceau.
    const step = Object.values(data.steps ?? {})
      .filter((s) => s.start <= now && now <= s.end && s.embedType !== 'song' && (s.titleConcept || s.title))
      .sort((a, b) => (a.depth ?? 0) - (b.depth ?? 0))[0];
    const show: Show | null = step
      ? { title: step.titleConcept || step.title!, desc: step.titleConcept && step.title !== step.titleConcept ? step.title : undefined, start: step.start * 1000, end: step.end * 1000, source: 'radiofrance' }
      : null;
    rfCache.set(id, { at: Date.now(), show });
    return show;
  } catch {
    return hit?.show ?? null;
  }
}

export async function currentShow(station: Station): Promise<Show | null> {
  const p = currentProgramme(guide[station.attrs['tvg-id'] ?? ''], Date.now());
  if (p) return { title: p.title, desc: p.desc, start: p.start, end: p.end, source: 'epg' };
  const rf = radioFranceId(station.url);
  return rf !== undefined ? radioFranceShow(rf) : null;
}
