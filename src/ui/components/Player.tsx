/** Mini-player permanent et barre d'onglets. */
import { useSelector } from '../../core/store';
import { store, togglePlay } from '../../app/state';
import { nav, openNowPlaying, selectTab, type Tab } from '../../app/nav';
import { t } from '../../i18n';
import type { PlayerState } from '../../services/player/RadioPlayer';
import { Artwork, EqBars } from './Artwork';
import { Icon, type IconName } from './Icon';

export function statusText(p: PlayerState): string | null {
  switch (p.status) {
    case 'loading':
      return t('statusLoading');
    case 'buffering':
      return t('statusBuffering');
    case 'reconnecting':
    case 'error':
      return p.error?.message ?? null;
    case 'paused':
      return t('statusPaused');
    default:
      return null;
  }
}

export const isActive = (p: PlayerState) => p.status === 'playing' || p.status === 'buffering' || p.status === 'loading' || p.status === 'reconnecting';

export function MiniPlayer() {
  const { p, station, track } = useSelector(store, (s) => {
    const id = s.player.stationId ?? s.lastStationId;
    return { p: s.player, station: id ? s.byId.get(id) : undefined, track: s.nowTrack };
  });
  if (!station) return null;
  const active = isActive(p);
  const status = p.stationId ? statusText(p) : t('lastListened');
  return (
    <div class={`mini ${p.status === 'error' ? 'is-error' : ''}`}>
      <button class="mini-main" onClick={openNowPlaying} aria-label="Ouvrir le lecteur">
        <div class="mini-art">
          <Artwork src={track?.artworkUrl ?? station.logo} name={station.name} size="xs" rounded="sm" logo={!track?.artworkUrl} />
        </div>
        <span class="mini-text">
          <span class="mini-title">{track?.title ?? station.name}</span>
          <span class={`mini-sub ${p.status === 'error' ? 'err' : ''}`}>
            {status ?? (track ? (track.artist ?? station.name) : <><EqBars active={p.status === 'playing'} class="eq-inline" /> {t('live')}</>)}
          </span>
        </span>
      </button>
      <button class="mini-btn" onClick={togglePlay} aria-label={active ? 'Pause' : 'Lecture'}>
        {p.status === 'loading' || p.status === 'reconnecting' ? <span class="spinner" /> : <Icon name={active ? 'pause' : 'play'} size={26} />}
      </button>
    </div>
  );
}

const TABS: { id: Tab; icon: IconName; label: () => string }[] = [
  { id: 'home', icon: 'home', label: () => t('tabHome') },
  { id: 'explore', icon: 'explore', label: () => t('tabExplore') },
  { id: 'library', icon: 'library', label: () => t('tabLibrary') },
  { id: 'favorites', icon: 'heart', label: () => t('tabFavorites') },
];

export function TabBar() {
  const tab = useSelector(nav, (s) => s.tab);
  return (
    <nav class="tabbar" aria-label="Navigation">
      {TABS.map((x) => (
        <button class={tab === x.id ? 'on' : ''} onClick={() => selectTab(x.id)} aria-current={tab === x.id ? 'page' : undefined}>
          <Icon name={x.id === 'favorites' && tab === 'favorites' ? 'heartFill' : x.icon} size={25} />
          <span>{x.label()}</span>
        </button>
      ))}
    </nav>
  );
}
