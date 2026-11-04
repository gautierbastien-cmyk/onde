import type { Track } from '../../core/types';

/**
 * Lien qui ouvre le morceau directement dans l'app Spotify : sa page exacte quand
 * le relais l'a trouvée, sinon une recherche « artiste titre » dans l'app.
 */
export function spotifyLink(t: Pick<Track, 'title' | 'artist' | 'spotifyUrl'>): string {
  const id = t.spotifyUrl && /open\.spotify\.com\/track\/([A-Za-z0-9]+)/.exec(t.spotifyUrl)?.[1];
  if (id) return `spotify:track:${id}`;
  return `spotify:search:${encodeURIComponent([t.artist, t.title].filter(Boolean).join(' '))}`;
}
