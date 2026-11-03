/** Modèle de données d'Onde. */

export type StreamKind = 'audio' | 'video' | 'unknown';

export type Verification =
  /** Contenu audio confirmé (en-têtes, codecs HLS ou sonde média). */
  | 'audio'
  /** Classée radio par analyse de la playlist, sans vérification réseau possible. */
  | 'probable'
  /** Flux injoignable lors de la vérification. */
  | 'unreachable';

export interface Station {
  /** Identifiant stable dérivé de l'URL normalisée du flux. */
  id: string;
  name: string;
  url: string;
  logo?: string;
  genres: string[];
  /** Code pays ISO 3166-1 alpha-2, en majuscules. */
  country?: string;
  language?: string;
  playlistIds: string[];
  /** Attributs EXTINF d'origine, conservés tels quels. */
  attrs: Record<string, string>;
  verification: Verification;
  isHls: boolean;
  addedAt: number;
}

export interface PlaylistSource {
  type: 'file' | 'url';
  /** Nom de fichier ou URL d'origine. */
  ref: string;
}

export interface ImportReport {
  totalEntries: number;
  kept: number;
  added: number;
  updated: number;
  duplicates: number;
  invalid: { line: number; name: string; reason: string }[];
  excluded: { name: string; url: string; reason: string }[];
  unverified: number;
  durationMs: number;
}

export interface Playlist {
  id: string;
  name: string;
  source: PlaylistSource;
  /** Contenu brut, conservé pour pouvoir réanalyser ou actualiser hors ligne. */
  raw: string;
  stationIds: string[];
  importedAt: number;
  updatedAt: number;
  report: ImportReport;
}

export type TrackSource = 'icy' | 'hls-id3' | 'icecast-status' | 'broadcaster' | 'proxy' | `recognition:${string}`;

/** Un morceau identifié, quelle que soit la méthode d'identification. */
export interface Track {
  id: string;
  title: string;
  artist?: string;
  album?: string;
  artworkUrl?: string;
  /** D'où viennent l'album et la pochette, quand ils ne viennent pas du flux. */
  enrichedBy?: 'itunes';
  stationId: string;
  stationName: string;
  source: TrackSource;
  /** Horodatage UTC (ms). */
  identifiedAt: number;
  /** Fuseau horaire de l'appareil au moment de l'identification. */
  timeZone: string;
  /** Chaîne brute reçue (StreamTitle, ID3…), pour transparence. */
  raw?: string;
}

export interface RecentPlay {
  stationId: string;
  playedAt: number;
}

export type Theme = 'dark' | 'light' | 'auto';
export type SortMode = 'alpha' | 'recent' | 'custom';
export type ViewMode = 'grid' | 'list';

export interface Preferences {
  theme: Theme;
  /** Recherche des pochettes via l'API publique iTunes Search (gratuite, sans compte). */
  artworkLookup: boolean;
  /** URL optionnelle d'un relais personnel (Cloudflare Worker gratuit) pour les flux sans CORS. */
  relayUrl: string;
  /** Utiliser le relais aussi pour lire les flux HTTP non sécurisés. */
  relayStreams: boolean;
  librarySort: SortMode;
  libraryView: ViewMode;
  locale: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: 'dark',
  artworkLookup: true,
  relayUrl: '',
  relayStreams: false,
  librarySort: 'alpha',
  libraryView: 'grid',
  locale: 'fr',
};
