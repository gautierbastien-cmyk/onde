import type { Track } from '../../core/types';
import { openSheet } from '../../app/nav';
import { formatTime } from '../../i18n';
import { Artwork } from './Artwork';

export function TrackRow({ track, showTime = true }: { track: Track; showTime?: boolean }) {
  return (
    <button class="row row-main track-row" onClick={() => openSheet({ type: 'track', id: track.id })}>
      <div class="row-art">
        <Artwork src={track.artworkUrl} name={track.artist || track.title} size="s" rounded="sm" />
      </div>
      <span class="row-text">
        <span class="row-title">{track.title}</span>
        <span class="row-sub">{[track.artist, track.stationName].filter(Boolean).join(' · ')}</span>
      </span>
      {showTime && <span class="row-time">{formatTime(track.identifiedAt)}</span>}
    </button>
  );
}

/** Carte compacte pour l'accueil. */
export function TrackCard({ track }: { track: Track }) {
  return (
    <button class="track-card" onClick={() => openSheet({ type: 'track', id: track.id })}>
      <Artwork src={track.artworkUrl} name={track.artist || track.title} size="fill" rounded="md" />
      <span class="tile-title">{track.title}</span>
      <span class="tile-sub">{track.artist ?? track.stationName}</span>
    </button>
  );
}
