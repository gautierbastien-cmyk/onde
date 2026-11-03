/** Accueil éditorial. */
import { useMemo, useState } from 'preact/hooks';
import { useSelector } from '../../core/store';
import { playStation, store, togglePlay } from '../../app/state';
import { openNowPlaying, openSheet, push, selectTab } from '../../app/nav';
import { genreFacets, searchStations, searchTracks, visibleStations } from '../../app/selectors';
import { countryName, flag, greeting, t } from '../../i18n';
import { Artwork, EqBars } from '../components/Artwork';
import { Icon } from '../components/Icon';
import { isActive, statusText } from '../components/Player';
import { StationList, StationShelf } from '../components/Station';
import { TrackCard, TrackRow } from '../components/Track';
import { Button, EmptyState, Screen, SearchField, SectionHeader } from '../components/UI';
import { useTint } from '../components/useTint';
import { GenreCards } from './Explore';

function HeroCard() {
  const { p, station, track, show } = useSelector(store, (s) => {
    const id = s.player.stationId ?? s.lastStationId;
    return { p: s.player, station: id ? s.byId.get(id) : undefined, track: s.nowTrack, show: s.nowShow };
  });
  const [r, g, b] = useTint([track?.artworkUrl, station?.logo], station?.name ?? '');
  if (!station) return null;
  const active = isActive(p);
  const current = !!p.stationId;
  return (
    <div class="hero" style={{ '--hero-rgb': `${r} ${g} ${b}` } as any}>
      <button class="hero-open" onClick={() => (current ? openNowPlaying() : playStation(station.id))} aria-label="Ouvrir le lecteur" />
      <div class="hero-label">
        {current ? (
          <>
            <EqBars active={p.status === 'playing'} class="eq-inline" /> {t('nowPlaying')}
          </>
        ) : (
          t('lastListened')
        )}
      </div>
      <div class="hero-content">
        <Artwork src={track?.artworkUrl ?? station.logo} name={station.name} size="l" rounded="lg" logo={!track?.artworkUrl} />
        <div class="hero-text">
          <h3>{track?.title ?? station.name}</h3>
          <p>{track ? (track.artist ?? station.name) : [station.country && `${flag(station.country)} ${countryName(station.country)}`, station.genres[0]].filter(Boolean).join(' · ')}</p>
          {track && <p class="hero-station">{station.name}</p>}
          {show && <p class="hero-station">{show.title}</p>}
          {current && statusText(p) && <p class="hero-status">{statusText(p)}</p>}
        </div>
      </div>
      <button class="hero-play" onClick={() => (current ? togglePlay() : playStation(station.id))} aria-label={active ? 'Pause' : 'Lecture'}>
        {p.status === 'loading' || p.status === 'reconnecting' ? <span class="spinner" /> : <Icon name={active ? 'pause' : 'play'} size={24} />}
        <span>{active ? 'Pause' : current ? 'Lecture' : t('resume')}</span>
      </button>
    </div>
  );
}

export function Home() {
  const [q, setQ] = useState('');
  const data = useSelector(store, (s) => ({
    ready: s.ready,
    stations: visibleStations(s),
    favorites: s.favorites,
    recents: s.recents,
    tracks: s.tracks,
    byId: s.byId,
    genres: genreFacets(s),
    hidden: s.hidden,
    importing: !!s.importProgress,
  }));
  const importing = data.importing;
  const favs = useMemo(() => data.favorites.map((id) => data.byId.get(id)).filter((x) => x && !data.hidden.includes(x.id)), [data.favorites, data.byId, data.hidden]) as any[];
  const recents = useMemo(() => data.recents.map((r) => data.byId.get(r.stationId)).filter((x) => x && !data.hidden.includes(x.id)).slice(0, 12), [data.recents, data.byId, data.hidden]) as any[];
  const results = useMemo(() => (q ? searchStations(data.stations, q).slice(0, 40) : []), [q, data.stations]);
  const trackResults = useMemo(() => (q ? searchTracks(data.tracks, q).slice(0, 10) : []), [q, data.tracks]);
  const date = new Intl.DateTimeFormat('fr', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

  return (
    <Screen
      title={t(greeting())}
      subtitle={<span class="date-line">{date}</span>}
      actions={
        <button class="icon-btn" onClick={() => push({ type: 'settings' })} aria-label={t('settings')}>
          <Icon name="gear" size={24} />
        </button>
      }
    >
      {data.ready && !data.stations.length && !data.byId.size ? (
        <div class="welcome">
          <div class="welcome-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <h2>{t('welcomeTitle')}</h2>
          {importing ? (
            <p>Importation de votre playlist en cours. Vos radios apparaissent dans un instant.</p>
          ) : (
            <>
              <p>{t('welcomeText')}</p>
              <Button icon="plus" onClick={() => openSheet({ type: 'import' })}>
                {t('importPlaylist')}
              </Button>
            </>
          )}
          <button class="link-btn center" onClick={() => openSheet({ type: 'install' })}>
            Installer Onde sur l’écran d’accueil
          </button>
        </div>
      ) : (
        <>
          <div class="pad">
            <SearchField value={q} onInput={setQ} placeholder={t('searchPlaceholder')} />
          </div>
          {q ? (
            <div class="search-results">
              {results.length ? (
                <>
                  <SectionHeader title={t('stations')} />
                  <StationList stations={results} />
                </>
              ) : null}
              {trackResults.length ? (
                <>
                  <SectionHeader title={t('tracks')} />
                  <div class="list">
                    {trackResults.map((tr) => (
                      <TrackRow track={tr} />
                    ))}
                  </div>
                </>
              ) : null}
              {!results.length && !trackResults.length && <EmptyState icon="search" title={t('noResults')} text={`« ${q} »`} />}
            </div>
          ) : (
            <>
              <div class="pad">
                <HeroCard />
              </div>
              {favs.length > 0 && (
                <section>
                  <SectionHeader title={t('favorites')} action={t('seeAll')} onAction={() => selectTab('favorites')} />
                  <StationShelf stations={favs} size="l" />
                </section>
              )}
              {recents.length > 0 && (
                <section>
                  <SectionHeader title={t('recents')} action={t('seeAll')} onAction={() => push({ type: 'collection', kind: 'recents', value: '', title: t('recents') })} />
                  <StationShelf stations={recents} />
                </section>
              )}
              {data.tracks.length > 0 && (
                <section>
                  <SectionHeader title={t('latestTracks')} action={t('seeAll')} onAction={() => (selectTab('library'), push({ type: 'history' }))} />
                  <div class="shelf">
                    {data.tracks.slice(0, 10).map((tr) => (
                      <TrackCard track={tr} />
                    ))}
                  </div>
                </section>
              )}
              {data.genres.length > 0 && (
                <section>
                  <SectionHeader title={t('genres')} action={t('seeAll')} onAction={() => selectTab('explore')} />
                  <GenreCards facets={data.genres.slice(0, 6)} kind="genre" />
                </section>
              )}
              {!favs.length && !recents.length && (
                <section>
                  <SectionHeader title={t('allStations')} action={t('seeAll')} onAction={() => selectTab('library')} />
                  <StationShelf stations={data.stations.slice(0, 12)} />
                </section>
              )}
            </>
          )}
        </>
      )}
    </Screen>
  );
}
