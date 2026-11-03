/** Présentations d'une station : tuile (grille), carte large, ligne (liste). */
import { useEffect, useRef, useState } from 'preact/hooks';
import type { Station } from '../../core/types';
import { useSelector } from '../../core/store';
import { playStation, store, toggleFavorite } from '../../app/state';
import { openSheet } from '../../app/nav';
import { countryName, flag } from '../../i18n';
import { Artwork, EqBars } from './Artwork';
import { Icon } from './Icon';

export function stationSubtitle(s: Station, withCountry = true) {
  const parts: string[] = [];
  if (withCountry && s.country) parts.push(`${flag(s.country)} ${countryName(s.country)}`);
  if (s.genres[0]) parts.push(s.genres[0]);
  return parts.join(' · ');
}

/** Toucher = lecture ; appui long = menu de la station. */
function usePress(onTap: () => void, onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const long = useRef(false);
  const start = useRef<[number, number]>([0, 0]);
  return {
    onPointerDown: (e: PointerEvent) => {
      long.current = false;
      start.current = [e.clientX, e.clientY];
      timer.current = setTimeout(() => {
        long.current = true;
        navigator.vibrate?.(8);
        onLong();
      }, 480);
    },
    onPointerMove: (e: PointerEvent) => {
      if (Math.hypot(e.clientX - start.current[0], e.clientY - start.current[1]) > 8) clearTimeout(timer.current);
    },
    onPointerUp: () => clearTimeout(timer.current),
    onPointerCancel: () => clearTimeout(timer.current),
    onContextMenu: (e: Event) => {
      e.preventDefault();
      clearTimeout(timer.current);
      if (!long.current) {
        long.current = true;
        onLong();
      }
    },
    onClick: () => {
      if (long.current) return;
      onTap();
    },
  };
}

function useIsCurrent(id: string) {
  return useSelector(store, (s) => ({ current: s.player.stationId === id, playing: s.player.stationId === id && (s.player.status === 'playing' || s.player.status === 'buffering') }));
}

export function StationTile({ station, queue, size = 'm' }: { station: Station; queue?: string[]; size?: 'm' | 'l' }) {
  const { current, playing } = useIsCurrent(station.id);
  const press = usePress(
    () => playStation(station.id, queue),
    () => openSheet({ type: 'station', id: station.id }),
  );
  return (
    <button class={`tile tile-${size} ${current ? 'current' : ''}`} {...press} aria-label={`Lire ${station.name}`}>
      <div class="tile-art">
        <Artwork src={station.logo} name={station.name} size="fill" rounded="lg" logo />
        {current && (
          <span class="tile-badge">
            <EqBars active={playing} />
          </span>
        )}
      </div>
      <span class="tile-title">{station.name}</span>
      <span class="tile-sub">{stationSubtitle(station) || ' '}</span>
    </button>
  );
}

export function StationRow({ station, queue, trailing }: { station: Station; queue?: string[]; trailing?: preact.ComponentChildren }) {
  const { current, playing } = useIsCurrent(station.id);
  const isFav = useSelector(store, (s) => s.favorites.includes(station.id));
  const press = usePress(
    () => playStation(station.id, queue),
    () => openSheet({ type: 'station', id: station.id }),
  );
  return (
    <div class={`row ${current ? 'current' : ''}`}>
      <button class="row-main" {...press} aria-label={`Lire ${station.name}`}>
        <div class="row-art">
          <Artwork src={station.logo} name={station.name} size="s" rounded="sm" logo />
          {current && (
            <span class="row-badge">
              <EqBars active={playing} />
            </span>
          )}
        </div>
        <span class="row-text">
          <span class="row-title">{station.name}</span>
          <span class="row-sub">{stationSubtitle(station) || station.url.replace(/^https?:\/\//, '')}</span>
        </span>
      </button>
      {trailing ?? (
        <>
          <button class={`icon-btn fav ${isFav ? 'on' : ''}`} onClick={() => toggleFavorite(station.id)} aria-label={isFav ? 'Retirer des favoris' : 'Ajouter aux favoris'}>
            <Icon name={isFav ? 'heartFill' : 'heart'} size={22} />
          </button>
          <button class="icon-btn" onClick={() => openSheet({ type: 'station', id: station.id })} aria-label="Plus d’options">
            <Icon name="more" size={22} />
          </button>
        </>
      )}
    </div>
  );
}

/**
 * Rendu progressif : avec plusieurs milliers de stations, on n'affiche
 * qu'un premier lot, puis la suite à l'approche du bas de l'écran.
 */
function useProgressive<T>(items: T[], step = 90) {
  const [count, setCount] = useState(step);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => setCount(step), [items]);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || count >= items.length) return;
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setCount((c) => c + step), {
      root: el.closest('.scroller'),
      rootMargin: '1200px 0px',
    });
    io.observe(el);
    return () => io.disconnect();
  }, [count, items]);
  return { visible: items.length > count ? items.slice(0, count) : items, sentinel: count < items.length ? <div ref={sentinel} class="sentinel" /> : null };
}

export function StationGrid({ stations, queue }: { stations: Station[]; queue?: string[] }) {
  const q = queue ?? stations.map((s) => s.id);
  const { visible, sentinel } = useProgressive(stations);
  return (
    <>
      <div class="grid">
        {visible.map((s) => (
          <StationTile key={s.id} station={s} queue={q} />
        ))}
      </div>
      {sentinel}
    </>
  );
}

export function StationList({ stations, queue }: { stations: Station[]; queue?: string[] }) {
  const q = queue ?? stations.map((s) => s.id);
  const { visible, sentinel } = useProgressive(stations, 150);
  return (
    <>
      <div class="list">
        {visible.map((s) => (
          <StationRow key={s.id} station={s} queue={q} />
        ))}
      </div>
      {sentinel}
    </>
  );
}

/** Rangée défilante horizontale (accueil). */
export function StationShelf({ stations, size = 'm' }: { stations: Station[]; size?: 'm' | 'l' }) {
  const q = stations.map((s) => s.id);
  return (
    <div class="shelf">
      {stations.map((s) => (
        <StationTile key={s.id} station={s} queue={q} size={size} />
      ))}
    </div>
  );
}
