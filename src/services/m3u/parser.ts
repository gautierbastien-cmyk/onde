/**
 * Analyseur M3U / M3U8 « étendu » (format IPTV / radio).
 * Fonction pure, sans DOM : testable sous Node.
 *
 * Reconnaît #EXTM3U, #EXTINF (durée, attributs, titre), #EXTGRP, #EXTVLCOPT,
 * les guillemets droits, simples ou typographiques (“ ”), les fins de ligne
 * Windows/Mac, le BOM et les listes « nues » (une URL par ligne).
 */

export interface M3UEntry {
  /** Numéro de ligne (1-based) de l'URL dans le fichier. */
  line: number;
  name: string;
  url: string;
  duration: number;
  attrs: Record<string, string>;
  /** Groupe issu de #EXTGRP s'il n'y a pas de group-title. */
  group?: string;
  /** Options VLC (#EXTVLCOPT), conservées pour information. */
  options: Record<string, string>;
}

export interface M3UParseResult {
  entries: M3UEntry[];
  /** Attributs de l'en-tête #EXTM3U (url-tvg, etc.). */
  header: Record<string, string>;
  /** true si le fichier est en réalité un flux HLS (#EXT-X-…), pas une liste de stations. */
  isHlsMediaPlaylist: boolean;
  /** Lignes #EXTINF sans URL derrière. */
  orphans: { line: number; name: string }[];
}

const QUOTES: Record<string, string> = { '"': '"', "'": "'", '“': '”', '”': '”', '«': '»', '„': '“' };

/** Analyse « clé=valeur clé2="valeur 2" … , Titre ». Renvoie les attributs et l'index du titre. */
export function parseAttributes(s: string): { attrs: Record<string, string>; rest: string } {
  const attrs: Record<string, string> = {};
  let i = 0;
  const n = s.length;
  while (i < n) {
    while (i < n && /\s/.test(s[i])) i++;
    if (i >= n) break;
    if (s[i] === ',') return { attrs, rest: s.slice(i + 1) };
    // Lecture de la clé
    const keyStart = i;
    while (i < n && !/[\s=,]/.test(s[i])) i++;
    const key = s.slice(keyStart, i);
    if (s[i] !== '=') {
      // Jeton isolé (rare) : on l'ignore.
      if (s[i] === ',') return { attrs, rest: s.slice(i + 1) };
      continue;
    }
    i++; // '='
    let value = '';
    const open = s[i];
    const close = QUOTES[open];
    if (close) {
      i++;
      const end = s.indexOf(close, i);
      // Guillemet fermant absent : on s'arrête à la virgule suivante.
      const stop = end === -1 ? (s.indexOf(',', i) === -1 ? n : s.indexOf(',', i)) : end;
      value = s.slice(i, stop);
      i = end === -1 ? stop : stop + 1;
    } else {
      const start = i;
      while (i < n && !/[\s,]/.test(s[i])) i++;
      value = s.slice(start, i);
    }
    if (key) attrs[key.toLowerCase()] = value.trim();
  }
  return { attrs, rest: '' };
}

function parseExtinf(body: string): { duration: number; attrs: Record<string, string>; name: string } {
  // body = "-1 tvg-logo=… group-title=…,Nom"
  const m = /^\s*(-?\d+(?:\.\d+)?)?/.exec(body);
  const duration = m && m[1] ? Number(m[1]) : -1;
  const { attrs, rest } = parseAttributes(body.slice(m ? m[0].length : 0));
  return { duration, attrs, name: rest.trim() };
}

export function parseM3U(input: string): M3UParseResult {
  const text = input.replace(/^﻿/, '');
  const lines = text.split(/\r\n|\r|\n/);
  const entries: M3UEntry[] = [];
  const orphans: M3UParseResult['orphans'] = [];
  let header: Record<string, string> = {};
  let isHlsMediaPlaylist = false;

  let pending: { line: number; duration: number; attrs: Record<string, string>; name: string } | null = null;
  let group: string | undefined;
  let options: Record<string, string> = {};

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx].trim();
    if (!line) continue;

    if (line.startsWith('#')) {
      const upper = line.slice(0, 12).toUpperCase();
      if (upper.startsWith('#EXTM3U')) {
        header = parseAttributes(line.slice(7)).attrs;
      } else if (upper.startsWith('#EXTINF:')) {
        if (pending) orphans.push({ line: pending.line, name: pending.name });
        pending = { line: idx + 1, ...parseExtinf(line.slice(8)) };
      } else if (upper.startsWith('#EXTGRP:')) {
        group = line.slice(8).trim() || undefined;
      } else if (upper.startsWith('#EXTVLCOPT:')) {
        const opt = line.slice(11);
        const eq = opt.indexOf('=');
        if (eq > 0) options[opt.slice(0, eq).trim().toLowerCase()] = opt.slice(eq + 1).trim();
      } else if (/^#EXT-X-(TARGETDURATION|MEDIA-SEQUENCE|STREAM-INF|VERSION)/i.test(line)) {
        isHlsMediaPlaylist = true;
      }
      continue;
    }

    // Ligne d'URL
    entries.push({
      line: idx + 1,
      name: pending?.name ?? '',
      url: line,
      duration: pending?.duration ?? -1,
      attrs: pending?.attrs ?? {},
      group: pending?.attrs['group-title'] ? undefined : group,
      options,
    });
    pending = null;
    group = undefined;
    options = {};
  }
  if (pending) orphans.push({ line: pending.line, name: pending.name });

  return { entries, header, isHlsMediaPlaylist, orphans };
}

/** Décode un fichier en UTF-8, avec repli Windows-1252 (fréquent pour les vieux fichiers .m3u). */
export function decodePlaylist(bytes: ArrayBuffer | Uint8Array): string {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('windows-1252').decode(data);
  }
}
