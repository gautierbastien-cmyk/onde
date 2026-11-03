/**
 * Classement d'une entrée de playlist : radio audio, flux vidéo/TV, ou incertain.
 *
 * L'extension de l'URL n'est qu'un indice parmi d'autres : on combine les
 * attributs EXTINF, le groupe, le nom, l'hôte, le chemin et le port. Les
 * entrées incertaines sont ensuite vérifiées sur le réseau (voir probe.ts).
 */
import type { M3UEntry } from './parser';
import type { StreamKind } from '../../core/types';

export interface Classification {
  kind: StreamKind;
  score: number;
  reasons: string[];
}

const AUDIO_EXT = /\.(mp3|aac|aacp|m4a|ogg|oga|opus|flac|wav|weba)(?:$|[?#;])/i;
const VIDEO_EXT = /\.(mp4|m4v|mkv|avi|mov|webm|mpd|flv|wmv|3gp)(?:$|[?#])/i;
const TS_EXT = /\.ts(?:$|[?#])/i;
const AUDIO_HOST = /(icecast|shoutcast|streamtheworld|radiojar|zeno\.fm|radio\.co|radioking|infomaniak|ice\d*\.|audio|radiofrance|streema|laut\.fm|somafm|live365|radionomy|stream\.?radio|radio|fm\b)/i;
const AUDIO_PATH = /(\/;|\/stream(?:$|[/?])|\/live(?:\.mp3)?$|\/listen|\/radio|icecast|shoutcast|\/(?:hi|lo|high|low)(?:\.mp3)?$|-(?:mp3|aac)(?:$|[-?])|\b(?:128|192|256|320|64|96)k?(?:bps)?\b)/i;
const VIDEO_WORDS = /\b(tv|télé|tele|television|télévision|channel|chaîne|chaine|movie|movies|film|films|cinema|cinéma|series|séries|serie|vod|replay|sport[s]? ?tv|news ?tv|kids|enfants|documentaire|xxx|adult|pluto|samsung tv|ppv|uhd|fhd|4k|hevc|h\.?265|h\.?264)\b/i;
const RESOLUTION = /\b(\d{3,4}p|hd|sd|fhd|uhd)\b/i;
const RADIO_WORDS = /\b(radio|radios|fm|am|webradio|web radio|antenne|onda|rádio|rundfunk|sender|podcast)\b/i;
const MUSIC_WORDS = /\b(music|musique|jazz|classique|classical|rock|pop|hits|lounge|chill|ambient|electro|techno|house|soul|funk|blues|reggae|metal|country|talk)\b/i;

export function classify(entry: M3UEntry): Classification {
  let score = 0;
  const reasons: string[] = [];
  const add = (delta: number, reason: string) => {
    score += delta;
    reasons.push(`${delta > 0 ? '+' : ''}${delta} ${reason}`);
  };

  const a = entry.attrs;
  const group = (a['group-title'] ?? entry.group ?? '').toLowerCase();
  const name = entry.name.toLowerCase();
  let url: URL | null = null;
  try {
    url = new URL(entry.url);
  } catch {
    /* validé ailleurs */
  }
  const path = url ? url.pathname + url.search : entry.url;
  const host = url?.hostname ?? '';

  // Attributs explicites
  if (a['radio'] === 'true' || a['tvg-type'] === 'radio' || a['type'] === 'radio') add(4, 'attribut radio');
  if (a['tvg-type'] === 'tv' || a['type'] === 'tv' || a['type'] === 'video') add(-4, 'attribut TV');
  if (a['tvg-chno'] || a['tvg-shift'] || a['catchup'] || a['catchup-source'] || a['timeshift']) add(-2, 'attributs TV (numéro de chaîne, replay)');

  // Groupe
  if (RADIO_WORDS.test(group)) add(3, 'groupe radio');
  else if (MUSIC_WORDS.test(group)) add(1, 'groupe musical');
  if (VIDEO_WORDS.test(group)) add(-3, 'groupe TV/vidéo');

  // Nom
  if (/\bradio\b|\bfm\b|\bwebradio\b/.test(name)) add(2, 'nom de radio');
  if (RESOLUTION.test(name)) add(-3, 'résolution vidéo dans le nom');
  if (VIDEO_WORDS.test(name)) add(-2, 'mot TV dans le nom');

  // URL
  if (AUDIO_EXT.test(path)) add(3, 'extension audio');
  if (VIDEO_EXT.test(path)) add(-4, 'extension vidéo');
  if (TS_EXT.test(path)) add(-2, 'segment MPEG-TS');
  if (AUDIO_HOST.test(host)) add(2, 'hôte de streaming audio');
  if (AUDIO_PATH.test(path)) add(1, 'chemin typique Icecast/Shoutcast');
  if (url && /^(8000|8001|8002|8080|8100|8200|8443|9000)$/.test(url.port) && !/\.m3u8/i.test(path)) add(1, 'port Icecast/Shoutcast');
  if (/\/(hls|live)\/[^/]*\.m3u8/i.test(path) && !RADIO_WORDS.test(group)) add(-1, 'HLS générique');
  if (/(\d{3,4}p|video|tv|chunklist_b\d{6,})/i.test(path) && !AUDIO_EXT.test(path)) add(-1, 'indice vidéo dans l’URL');
  if (/audio/i.test(path)) add(1, '« audio » dans l’URL');

  const kind: StreamKind = score >= 3 ? 'audio' : score <= -3 ? 'video' : 'unknown';
  return { kind, score, reasons };
}
