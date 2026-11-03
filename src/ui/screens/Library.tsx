/** Bibliothèque, collections, favoris. */
import { useMemo, useRef, useState } from 'preact/hooks';
import { useSelector } from '../../core/store';
import type { SortMode, Station } from '../../core/types';
import { playStation, reorderFavorites, setPrefs, store, toggleFavorite } from '../../app/state';
import { openSheet, push } from '../../app/nav';
import { collection, searchStations, visibleStations } from '../../app/selectors';
import { plural, t } from '../../i18n';
import { Artwork } from '../components/Artwork';
import { Icon } from '../components/Icon';
import { StationGrid, StationList, stationSubtitle } from '../components/Station';
import { Button, EmptyState, Screen, SearchField } from '../components/UI';

const SORTS: { value: SortMode; label: string }[] = [
  { value: 'alpha', label: 'A → Z' },
  { value: 'recent', label: 'Ajout récent' },
  { value: 'custom', label: 'Ordre des playlists' },
];

function sortStations(list: Station[], mode: SortMode, playlistOrder: string[]): Station[] {
  if (mode === 'recent') return [...list].sort((a, b) => b.addedAt - a.addedAt || a.name.localeCompare(b.name, 'fr'));
  if (mode === 'custom') {
    const pos = new Map(playlistOrder.map((id, i) => [id, i]));
    return [...list].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  }
  return list; // déjà trié A → Z
}

function StationsToolbar({ count }: { count: number }) {
  const prefs = useSelector(store, (s) => s.prefs);
  const next = SORTS[(SORTS.findIndex((x) => x.value === prefs.librarySort) + 1) % SORTS.length];
  return (
    <div class="toolbar pad">
      <span class="toolbar-count">{plural(count, 'stationsOne', 'stationsMany')}</span>
      <button class="chip" onClick={() => setPrefs({ librarySort: next.value })} aria-label="Changer le tri">
        <Icon name="sort" size={16} />
        {SORTS.find((x) => x.value === prefs.librarySort)?.label}
      </button>
      <button class="icon-btn" onClick={() => setPrefs({ libraryView: prefs.libraryView === 'grid' ? 'list' : 'grid' })} aria-label="Changer l’affichage">
        <Icon name={prefs.libraryView === 'grid' ? 'list' : 'grid'} size={22} />
      </button>
    </div>
  );
}

function Stations({ stations }: { stations: Station[] }) {
  const view = useSelector(store, (s) => s.prefs.libraryView);
  return view === 'grid' ? <StationGrid stations={stations} /> : <StationList stations={stations} />;
}

export function Library() {
  const [q, setQ] = useState('');
  const [playlist, setPlaylist] = useState<string | null>(null);
  const d = useSelector(store, (s) => ({
    stations: visibleStations(s),
    playlists: s.playlists,
    hidden: s.hidden.length,
    tracks: s.tracks.length,
    recents: s.recents.length,
    sort: s.prefs.librarySort,
    total: s.stations.length,
  }));
  const order = useMemo(() => d.playlists.flatMap((p) => p.stationIds), [d.playlists]);
  const list = useMemo(() => {
    let l = playlist ? d.stations.filter((s) => s.playlistIds.includes(playlist)) : d.stations;
    if (q) return searchStations(l, q);
    return sortStations(l, d.sort, order);
  }, [d.stations, q, playlist, d.sort, order]);

  return (
    <Screen
      title={t('tabLibrary')}
      actions={
        <button class="icon-btn" onClick={() => openSheet({ type: 'import' })} aria-label={t('importPlaylist')}>
          <Icon name="plus" size={26} />
        </button>
      }
    >
      <div class="pad">
        <div class="group-body">
          <button class="cell" onClick={() => push({ type: 'history' })}>
            <span class="cell-icon" style={{ background: 'linear-gradient(135deg,#ff8a4c,#ff3d6e)' }}>
              <Icon name="note" size={18} />
            </span>
            <span class="cell-label">{t('history')}</span>
            <span class="cell-detail">{d.tracks || ''}</span>
            <Icon name="chevron" size={16} class="cell-chevron" />
          </button>
          <button class="cell" onClick={() => push({ type: 'collection', kind: 'recents', value: '', title: t('recents') })}>
            <span class="cell-icon" style={{ background: 'linear-gradient(135deg,#5e5ce6,#bf5af2)' }}>
              <Icon name="clock" size={18} />
            </span>
            <span class="cell-label">{t('recents')}</span>
            <span class="cell-detail">{d.recents || ''}</span>
            <Icon name="chevron" size={16} class="cell-chevron" />
          </button>
          <button class="cell" onClick={() => push({ type: 'playlists' })}>
            <span class="cell-icon" style={{ background: 'linear-gradient(135deg,#30b0c7,#0a84ff)' }}>
              <Icon name="doc" size={18} />
            </span>
            <span class="cell-label">{t('playlists')}</span>
            <span class="cell-detail">{d.playlists.length || ''}</span>
            <Icon name="chevron" size={16} class="cell-chevron" />
          </button>
          {d.hidden > 0 && (
            <button class="cell" onClick={() => push({ type: 'collection', kind: 'hidden', value: '', title: t('hiddenStations') })}>
              <span class="cell-icon" style={{ background: 'linear-gradient(135deg,#636366,#3a3a3c)' }}>
                <Icon name="eyeOff" size={18} />
              </span>
              <span class="cell-label">{t('hiddenStations')}</span>
              <span class="cell-detail">{d.hidden}</span>
              <Icon name="chevron" size={16} class="cell-chevron" />
            </button>
          )}
        </div>
      </div>

      {d.total === 0 ? (
        <EmptyState icon="radio" title="Bibliothèque vide" text={t('welcomeText')}>
          <Button icon="plus" onClick={() => openSheet({ type: 'import' })}>
            {t('importPlaylist')}
          </Button>
        </EmptyState>
      ) : (
        <>
          <div class="pad stack">
            <h2 class="section-title">{t('allStations')}</h2>
            <SearchField value={q} onInput={setQ} placeholder="Rechercher dans la bibliothèque" />
          </div>
          {d.playlists.length > 1 && (
            <div class="chips">
              <button class={`chip ${!playlist ? 'on' : ''}`} onClick={() => setPlaylist(null)}>
                Toutes
              </button>
              {d.playlists.map((p) => (
                <button class={`chip ${playlist === p.id ? 'on' : ''}`} onClick={() => setPlaylist(playlist === p.id ? null : p.id)}>
                  {p.name}
                </button>
              ))}
            </div>
          )}
          <StationsToolbar count={list.length} />
          {list.length ? <Stations stations={list} /> : <EmptyState icon="search" title={t('noResults')} text={q ? `« ${q} »` : ''} />}
        </>
      )}
    </Screen>
  );
}

export function Collection({ kind, value, title }: { kind: string; value: string; title: string }) {
  const stations = useSelector(store, (s) => collection(s, kind, value));
  const view = useSelector(store, (s) => s.prefs.libraryView);
  const ids = stations.map((s) => s.id);
  return (
    <Screen
      title={title}
      back
      subtitle={plural(stations.length, 'stationsOne', 'stationsMany')}
      actions={
        <button class="icon-btn" onClick={() => setPrefs({ libraryView: view === 'grid' ? 'list' : 'grid' })} aria-label="Changer l’affichage">
          <Icon name={view === 'grid' ? 'list' : 'grid'} size={22} />
        </button>
      }
    >
      {stations.length > 0 && kind !== 'hidden' && (
        <div class="pad">
          <div class="play-row">
            <Button icon="play" onClick={() => playStation(stations[0].id, ids)}>
              Lire
            </Button>
            <Button icon="refresh" variant="secondary" onClick={() => playStation(ids[Math.floor(Math.random() * ids.length)], ids)}>
              Au hasard
            </Button>
          </div>
        </div>
      )}
      {stations.length ? (
        kind === 'hidden' || view === 'list' ? (
          <StationList stations={stations} />
        ) : (
          <StationGrid stations={stations} />
        )
      ) : (
        <EmptyState icon="radio" title="Aucune station" text="" />
      )}
    </Screen>
  );
}

// ——— Favoris ———

function FavoritesEditor({ stations }: { stations: Station[] }) {
  const [order, setOrder] = useState(stations.map((s) => s.id));
  const [dragging, setDragging] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const byId = new Map(stations.map((s) => [s.id, s]));

  const onDown = (id: string) => (e: PointerEvent) => {
    e.preventDefault();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(id);
  };
  const onMove = (e: PointerEvent) => {
    if (!dragging || !listRef.current) return;
    const rows = [...listRef.current.querySelectorAll<HTMLElement>('[data-id]')];
    const target = rows.find((r) => {
      const b = r.getBoundingClientRect();
      return e.clientY >= b.top && e.clientY <= b.bottom;
    });
    const tid = target?.dataset.id;
    if (tid && tid !== dragging) {
      const next = order.filter((x) => x !== dragging);
      next.splice(order.indexOf(tid), 0, dragging);
      setOrder(next);
    }
  };
  const onUp = () => {
    if (dragging) reorderFavorites(order);
    setDragging(null);
  };

  return (
    <div class="list edit-list" ref={listRef} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
      {order.map((id) => {
        const s = byId.get(id);
        if (!s) return null;
        return (
          <div class={`row ${dragging === id ? 'dragging' : ''}`} data-id={id} key={id}>
            <button
              class="icon-btn remove"
              onClick={() => {
                setOrder(order.filter((x) => x !== id));
                toggleFavorite(id);
              }}
              aria-label={`Retirer ${s.name}`}
            >
              <span class="remove-dot" />
            </button>
            <div class="row-art">
              <Artwork src={s.logo} name={s.name} size="s" rounded="sm" logo />
            </div>
            <span class="row-text">
              <span class="row-title">{s.name}</span>
              <span class="row-sub">{stationSubtitle(s)}</span>
            </span>
            <span class="drag-handle" onPointerDown={onDown(id)} aria-label="Déplacer">
              <Icon name="drag" size={22} />
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function Favorites() {
  const [editing, setEditing] = useState(false);
  const stations = useSelector(store, (s) => s.favorites.map((id) => s.byId.get(id)).filter((x): x is Station => !!x && !s.hidden.includes(x.id)));
  const view = useSelector(store, (s) => s.prefs.libraryView);
  return (
    <Screen
      title={t('tabFavorites')}
      actions={
        stations.length > 0 && (
          <button class="text-btn" onClick={() => setEditing(!editing)}>
            {editing ? t('done') : t('edit')}
          </button>
        )
      }
    >
      {!stations.length ? (
        <EmptyState icon="heart" title={t('emptyFavorites')} text={t('emptyFavoritesText')} />
      ) : editing ? (
        <FavoritesEditor stations={stations} />
      ) : (
        <>
          <div class="toolbar pad">
            <span class="toolbar-count">{plural(stations.length, 'stationsOne', 'stationsMany')}</span>
            <button class="icon-btn" onClick={() => setPrefs({ libraryView: view === 'grid' ? 'list' : 'grid' })} aria-label="Changer l’affichage">
              <Icon name={view === 'grid' ? 'list' : 'grid'} size={22} />
            </button>
          </div>
          {view === 'grid' ? <StationGrid stations={stations} /> : <StationList stations={stations} />}
        </>
      )}
    </Screen>
  );
}
