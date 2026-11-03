/**
 * Importation d'une playlist : analyse → validation → classement → vérification
 * réseau des entrées incertaines → construction des stations et du rapport.
 *
 * Sans effet de bord : la persistance est faite par la bibliothèque.
 */
import { parseM3U } from './parser';
import { classify } from './classifier';
import { detectCountry, detectGenres, displayName, normalizeUrl, stationId, validateUrl, hash } from './normalize';
import type { ProbeResult } from './probe';
import type { ImportReport, Playlist, PlaylistSource, Station, Verification } from '../../core/types';

export interface ImportOptions {
  name: string;
  source: PlaylistSource;
  raw: string;
  /** Stations déjà présentes (toutes playlists confondues). */
  existing: Map<string, Station>;
  /** Playlist remplacée ou actualisée (même identifiant conservé). */
  replaceId?: string;
  probe?: (url: string) => Promise<ProbeResult>;
  /** Nombre maximal d'entrées vérifiées sur le réseau. */
  probeLimit?: number;
  onProgress?: (done: number, total: number) => void;
  signal?: AbortSignal;
}

export interface ImportResult {
  playlist: Playlist;
  stations: Station[];
  report: ImportReport;
}

export class ImportError extends Error {}

async function pool<T>(items: T[], size: number, fn: (item: T) => Promise<void>, signal?: AbortSignal) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(size, items.length) }, async () => {
      while (i < items.length && !signal?.aborted) await fn(items[i++]);
    }),
  );
}

export async function importPlaylist(opts: ImportOptions): Promise<ImportResult> {
  const started = Date.now();
  const parsed = parseM3U(opts.raw);
  if (!parsed.entries.length) {
    if (parsed.isHlsMediaPlaylist) throw new ImportError('Ce fichier est un flux HLS, pas une liste de stations.');
    throw new ImportError('Aucune entrée trouvée dans ce fichier.');
  }

  const report: ImportReport = {
    totalEntries: parsed.entries.length + parsed.orphans.length,
    kept: 0,
    added: 0,
    updated: 0,
    duplicates: 0,
    invalid: parsed.orphans.map((o) => ({ line: o.line, name: o.name || '(sans nom)', reason: 'EXTINF sans URL' })),
    excluded: [],
    unverified: 0,
    durationMs: 0,
  };

  const playlistId = opts.replaceId ?? 'p_' + hash(opts.source.ref + started) + started.toString(36);
  const seen = new Set<string>();
  type Candidate = { station: Station; kind: 'audio' | 'unknown'; reasons: string[] };
  const candidates: Candidate[] = [];

  for (const entry of parsed.entries) {
    const check = validateUrl(entry.url);
    const name = displayName(entry, entry.url);
    if (!check.ok) {
      report.invalid.push({ line: entry.line, name, reason: check.reason });
      continue;
    }
    const key = normalizeUrl(check.url);
    if (seen.has(key)) {
      report.duplicates++;
      continue;
    }
    seen.add(key);

    const c = classify(entry);
    if (c.kind === 'video') {
      report.excluded.push({ name, url: check.url, reason: 'Flux vidéo/TV : ' + c.reasons.filter((r) => r.startsWith('-')).map((r) => r.replace(/^-\d+ /, '')).join(', ') });
      continue;
    }
    const country = detectCountry(entry);
    const id = stationId(check.url);
    const prev = opts.existing.get(id);
    const station: Station = {
      id,
      name,
      url: check.url,
      logo: entry.attrs['tvg-logo'] || entry.attrs['logo'] || prev?.logo || undefined,
      genres: detectGenres(entry, country),
      country,
      language: entry.attrs['tvg-language'] || undefined,
      playlistIds: [...new Set([...(prev?.playlistIds ?? []), playlistId])],
      attrs: entry.attrs,
      verification: c.kind === 'audio' ? 'probable' : (prev?.verification ?? 'probable'),
      isHls: /\.m3u8?(\?|$)/i.test(new URL(check.url).pathname),
      addedAt: prev?.addedAt ?? started,
    };
    candidates.push({ station, kind: c.kind, reasons: c.reasons });
  }

  // Vérification réseau : d'abord les entrées incertaines, puis les HLS (souvent TV).
  const toProbe = candidates
    .filter((c) => c.kind === 'unknown' || c.station.isHls)
    .filter((c) => opts.existing.get(c.station.id)?.verification !== 'audio')
    .slice(0, opts.probeLimit ?? 300);
  const rejected = new Set<Candidate>();
  if (opts.probe && toProbe.length) {
    let done = 0;
    opts.onProgress?.(0, toProbe.length);
    await pool(
      toProbe,
      8,
      async (c) => {
        const r = await opts.probe!(c.station.url);
        if (r.kind === 'video') {
          rejected.add(c);
          report.excluded.push({ name: c.station.name, url: c.station.url, reason: `Piste vidéo détectée (${r.detail ?? r.via})` });
        } else if (r.kind === 'audio') {
          c.station.verification = 'audio';
          c.kind = 'audio';
        } else if (r.kind === 'unreachable') {
          c.station.verification = 'unreachable';
        }
        opts.onProgress?.(++done, toProbe.length);
      },
      opts.signal,
    );
  }

  // Playlist à dominante radio (≥ 80 % d'entrées reconnues) : les entrées incertaines
  // bénéficient du doute ; seules les pistes vidéo confirmées sont écartées.
  const radioPlaylist = candidates.length > 0 && candidates.filter((c) => c.kind === 'audio').length / candidates.length >= 0.8;
  const stations: Station[] = [];
  for (const c of candidates) {
    if (rejected.has(c)) continue;
    // Sinon, une entrée sans aucun indice radio ni confirmation n'est pas conservée.
    if (!radioPlaylist && c.kind === 'unknown' && c.station.verification !== 'audio' && !opts.existing.has(c.station.id)) {
      const score = Number(c.reasons.reduce((s, r) => s + parseInt(r, 10), 0));
      if (score < 1) {
        report.excluded.push({ name: c.station.name, url: c.station.url, reason: 'Aucun indice de flux radio, contenu non vérifiable' });
        continue;
      }
    }
    if (c.station.verification !== 'audio') report.unverified++;
    if (opts.existing.has(c.station.id)) report.updated++;
    else report.added++;
    stations.push(c.station);
  }
  report.kept = stations.length;
  report.durationMs = Date.now() - started;

  const playlist: Playlist = {
    id: playlistId,
    name: opts.name,
    source: opts.source,
    raw: opts.raw,
    stationIds: stations.map((s) => s.id),
    epgUrl: epgUrl(parsed.header),
    importedAt: started,
    updatedAt: started,
    report,
  };
  return { playlist, stations, report };
}

function epgUrl(header: Record<string, string>): string | undefined {
  const first = (header['url-tvg'] || header['x-tvg-url'] || '').split(',')[0].trim();
  return validateUrl(first).ok ? first : undefined;
}

export const verificationLabel: Record<Verification, string> = {
  audio: 'Audio confirmé',
  probable: 'D’après la playlist',
  unreachable: 'Injoignable à l’import',
};
