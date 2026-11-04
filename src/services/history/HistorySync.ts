/**
 * Synchronisation de l'historique musical entre appareils, via le relais personnel
 * (fichier partagé sur le Pi). Chaque appareil envoie ses nouveaux titres et ses
 * suppressions, puis récupère ce qui a changé ailleurs. Le stockage local reste
 * géré par l'état de l'app.
 */
import type { Track } from '../../core/types';
import { sameSong } from '../artwork/ArtworkService';

export interface RemoteTrack {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  stationName?: string;
  stationUrl?: string;
  source?: string;
  identifiedAt: number;
  timeZone?: string;
  spotifyUrl?: string;
  deleted?: boolean;
}

const base = (relay: string) => relay.replace(/\/+$/, '') + '/history';

export async function pushHistory(relay: string, tracks: RemoteTrack[], deleted: string[]): Promise<boolean> {
  if (!tracks.length && !deleted.length) return true;
  const res = await fetch(base(relay), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tracks, deleted }),
    credentials: 'omit',
  });
  return res.ok;
}

export async function pullHistory(relay: string, since: number): Promise<{ tracks: RemoteTrack[]; now: number } | null> {
  const res = await fetch(`${base(relay)}?since=${since}`, { cache: 'no-store', credentials: 'omit' });
  if (!res.ok) return null;
  return res.json();
}

/**
 * Fusion : ajoute les titres venus d'ailleurs (sauf s'ils existent déjà ici, même sous
 * un autre identifiant) et applique les suppressions.
 */
export function mergeRemote(local: Track[], remote: RemoteTrack[], toLocal: (r: RemoteTrack) => Track): { add: Track[]; remove: string[] } {
  const ids = new Set(local.map((t) => t.id));
  const add: Track[] = [];
  const remove: string[] = [];
  for (const r of remote) {
    if (r.deleted) {
      if (ids.has(r.id)) remove.push(r.id);
      continue;
    }
    if (ids.has(r.id)) continue;
    const t = toLocal(r);
    const dup = [...local, ...add].some(
      (l) => l.stationName === t.stationName && Math.abs(l.identifiedAt - t.identifiedAt) < 15 * 60_000 && sameSong(l, t),
    );
    if (!dup) add.push(t);
  }
  return { add, remove };
}
