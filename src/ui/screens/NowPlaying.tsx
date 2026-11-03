/** Lecteur plein écran, inspiré d'Apple Music. */
import { useEffect, useRef, useState } from 'preact/hooks';
import { useSelector } from '../../core/store';
import { getPlayer, getRecognition, identifyNow, skip, store, toggleFavorite, togglePlay } from '../../app/state';
import { closeNowPlaying, nav, openSheet, push, selectTab } from '../../app/nav';
import { countryName, flag, formatTime, t } from '../../i18n';
import { Artwork, EqBars } from '../components/Artwork';
import { Icon } from '../components/Icon';
import { isActive, statusText } from '../components/Player';
import { useTint } from '../components/useTint';

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, [active]);
  return now;
}

const clock = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

const SOURCE_LABEL: Record<string, string> = {
  icy: 'Titre annoncé par la station (ICY)',
  'hls-id3': 'Titre annoncé par la station (ID3)',
  'icecast-status': 'Titre annoncé par la station (Icecast)',
  broadcaster: 'Titre publié par le diffuseur (API Radio France)',
  proxy: 'Titre annoncé par la station (via votre relais)',
  'recognition:shazam': 'Identifié par Shazam',
};

export function NowPlaying() {
  const open = useSelector(nav, (s) => s.nowPlaying);
  const { p, station, track, isFav, meta, sleepAt, show, recognizing, relay } = useSelector(store, (s) => {
    const id = s.player.stationId ?? s.lastStationId;
    return {
      p: s.player,
      station: id ? s.byId.get(id) : undefined,
      track: s.nowTrack,
      isFav: !!id && s.favorites.includes(id),
      meta: s.metaStatus,
      sleepAt: s.sleepAt,
      show: s.nowShow,
      recognizing: s.recognizing,
      relay: s.prefs.relayUrl,
    };
  });
  const [r, g, b] = useTint([track?.artworkUrl, station?.logo], station?.name ?? '');
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ y: number; dy: number; t: number } | null>(null);
  const active = isActive(p);
  const now = useNow(open && (active || !!sleepAt));

  useEffect(() => {
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', open ? `rgb(${r},${g},${b})` : '#050506');
  }, [open, r, g, b]);

  if (!station) return <div class="np" aria-hidden="true" />;

  const art = track?.artworkUrl;
  // Morceau identifié avec sa position : vraie progression (estimée) dans le morceau.
  const timed = track?.startedAt && track.endsAt && now < track.endsAt + 60_000 ? { start: track.startedAt, end: track.endsAt } : null;
  const status = statusText(p);
  const engines = getRecognition()?.onDemandEngines ?? [];

  const onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input')) return;
    drag.current = { y: e.clientY, dy: 0, t: Date.now() };
  };
  const onMove = (e: PointerEvent) => {
    if (!drag.current || !panel.current) return;
    const dy = Math.max(0, e.clientY - drag.current.y);
    drag.current.dy = dy;
    panel.current.style.transition = 'none';
    panel.current.style.transform = `translateY(${dy}px)`;
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !panel.current) return;
    panel.current.style.transition = '';
    panel.current.style.transform = '';
    if (d.dy > 140 || d.dy / Math.max(1, Date.now() - d.t) > 0.7) closeNowPlaying();
  };

  const goHistory = () => {
    closeNowPlaying();
    selectTab('library');
    push({ type: 'history' });
  };

  return (
    <div
      class={`np ${open ? 'open' : ''} ${active ? 'playing' : 'paused'}`}
      ref={panel}
      style={{ '--np-rgb': `${r} ${g} ${b}` } as any}
      aria-hidden={!open}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
    >
      <div class="np-bg">
        {(art || station.logo) && <img key={art ?? station.logo} src={art ?? station.logo} alt="" class="np-bg-img" />}
      </div>

      <div class="np-inner">
        <div class="np-top">
          <button class="np-icon" onClick={closeNowPlaying} aria-label="Réduire le lecteur">
            <Icon name="down" size={26} />
          </button>
          <div class="np-top-title">
            <span class="np-live">
              <i class={p.status === 'playing' ? 'pulse' : ''} />
              {t('live')}
            </span>
            <span class="np-top-station">{station.name}</span>
          </div>
          <button class="np-icon" onClick={() => openSheet({ type: 'station', id: station.id })} aria-label="Options de la station">
            <Icon name="more" size={24} />
          </button>
        </div>

        <div class="np-art-wrap">
          <div class="np-art" key={art ?? station.id}>
            {art ? (
              <>
                <img src={art} alt={track?.album ?? track?.title ?? ''} />
                <span class="np-art-station">
                  <Artwork src={station.logo} name={station.name} size="xs" rounded="sm" logo />
                </span>
              </>
            ) : (
              <div class="np-logo-card">
                <Artwork src={station.logo} name={station.name} size="fill" rounded="xl" logo />
              </div>
            )}
          </div>
        </div>

        <div class="np-info">
          <div class="np-titles" key={(track?.id ?? '') + station.id}>
            {show && (
              <p class="np-show">
                <Icon name="radio" size={14} />
                <span>{show.title}</span>
                {show.start && show.end ? <span class="np-show-time">{formatTime(show.start)}–{formatTime(show.end)}</span> : null}
              </p>
            )}
            <h2 class="np-title">{track?.title ?? station.name}</h2>
            <p class="np-artist">
              {track
                ? track.artist ?? station.name
                : [station.country && `${flag(station.country)} ${countryName(station.country)}`, station.genres[0]].filter(Boolean).join(' · ') || t('live')}
            </p>
            {track?.album && <p class="np-album">{track.album}</p>}
          </div>
          <button class={`np-fav ${isFav ? 'on' : ''}`} onClick={() => toggleFavorite(station.id)} aria-label={isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}>
            <Icon name={isFav ? 'heartFill' : 'heart'} size={26} />
          </button>
        </div>

        <div class="np-live-bar">
          <div class="np-live-track">
            {timed ? (
              <span class="np-song-fill" style={{ transform: `scaleX(${Math.min(1, Math.max(0, (now - timed.start) / (timed.end - timed.start)))})` }} />
            ) : (
              <span class={`np-live-fill ${p.status === 'playing' ? 'run' : ''}`} />
            )}
          </div>
          <div class="np-live-meta">
            <span>{timed ? `${clock(Math.min(now, timed.end) - timed.start)} / ${clock(timed.end - timed.start)}` : p.since && active ? clock(now - p.since) : '0:00'}</span>
            <span class={status && (p.status === 'error' || p.status === 'reconnecting') ? 'np-warn' : ''}>
              {status ?? (
                <>
                  <EqBars active={p.status === 'playing'} class="eq-inline" /> {t('statusPlaying')}
                </>
              )}
            </span>
          </div>
        </div>

        <div class="np-controls">
          <button class="np-skip" onClick={() => skip(-1)} aria-label="Station précédente">
            <Icon name="prev" size={38} />
          </button>
          <button class="np-play" onClick={togglePlay} aria-label={active ? 'Pause' : 'Lecture'}>
            {p.status === 'loading' || p.status === 'reconnecting' ? <span class="spinner big" /> : <Icon name={active ? 'pause' : 'play'} size={52} />}
          </button>
          <button class="np-skip" onClick={() => skip(1)} aria-label="Station suivante">
            <Icon name="next" size={38} />
          </button>
        </div>

        <p class="np-source">
          {!track && show?.desc
            ? show.desc
            : track && SOURCE_LABEL[track.source]
            ? SOURCE_LABEL[track.source] + (track.enrichedBy === 'spotify' ? ' · pochette Spotify' : track.enrichedBy === 'itunes' ? ' · pochette Apple Music' : '')
            : meta.state === 'unavailable' && p.status === 'playing'
              ? meta.reason
              : meta.state === 'searching' || (meta.state === 'active' && meta.waiting)
                ? 'En attente des informations musicales…'
                : ' '}
        </p>

        <div class="np-bottom">
          <button class={`np-tool ${sleepAt ? 'on' : ''}`} onClick={() => openSheet({ type: 'sleep' })} aria-label="Minuteur de mise en veille">
            <Icon name="moon" size={22} />
            {sleepAt && <span>{clock(sleepAt - now)}</span>}
          </button>
          {getPlayer()?.airPlayAvailable && (
            <button class="np-tool" onClick={() => getPlayer().showAirPlay()} aria-label="AirPlay">
              <Icon name="airplay" size={22} />
            </button>
          )}
          {relay && engines.some((e) => e.id === 'shazam') && (
            <button class={`np-tool np-shazam ${recognizing ? 'on' : ''}`} onClick={() => identifyNow()} disabled={recognizing || p.status !== 'playing'} aria-label="Identifier avec Shazam">
              {recognizing ? <span class="spinner small" /> : <Icon name="wave" size={22} />}
              <span>{recognizing ? 'Écoute…' : 'Shazam'}</span>
            </button>
          )}
          <button class="np-tool" onClick={goHistory} aria-label={t('history')}>
            <Icon name="clock" size={22} />
          </button>
        </div>
      </div>
    </div>
  );
}
