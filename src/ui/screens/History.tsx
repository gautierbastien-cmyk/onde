/** Historique musical : chronologique, recherche, suppression. */
import { useMemo, useState } from 'preact/hooks';
import { useSelector } from '../../core/store';
import { clearHistory, deleteTracks, store } from '../../app/state';
import { groupByDay, searchTracks } from '../../app/selectors';
import { formatDay, formatTime, plural, t } from '../../i18n';
import { Artwork } from '../components/Artwork';
import { TrackRow } from '../components/Track';
import { EmptyState, Screen, SearchField } from '../components/UI';

export function History() {
  const tracks = useSelector(store, (s) => s.tracks);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const filtered = useMemo(() => searchTracks(tracks, q), [tracks, q]);
  const groups = useMemo(() => groupByDay(filtered), [filtered]);

  const toggle = (id: string) => {
    const n = new Set(selected);
    n.has(id) ? n.delete(id) : n.add(id);
    setSelected(n);
  };

  return (
    <Screen
      title={t('history')}
      back
      subtitle={tracks.length ? plural(tracks.length, 'tracksOne', 'tracksMany') : undefined}
      actions={
        tracks.length > 0 && (
          <button class="text-btn" onClick={() => (setEditing(!editing), setSelected(new Set()))}>
            {editing ? t('done') : t('edit')}
          </button>
        )
      }
    >
      {!tracks.length ? (
        <EmptyState icon="note" title={t('emptyHistory')} text={t('emptyHistoryText')} />
      ) : (
        <>
          <div class="pad">
            <SearchField value={q} onInput={setQ} placeholder="Titre, artiste, album, radio" />
          </div>
          {groups.map(([day, list]) => (
            <section key={day}>
              <h3 class="day-header">{formatDay(list[0].identifiedAt)}</h3>
              <div class="list">
                {list.map((tr) =>
                  editing ? (
                    <button class={`row row-main track-row ${selected.has(tr.id) ? 'selected' : ''}`} onClick={() => toggle(tr.id)}>
                      <span class={`check ${selected.has(tr.id) ? 'on' : ''}`} />
                      <div class="row-art">
                        <Artwork src={tr.artworkUrl} name={tr.artist || tr.title} size="s" rounded="sm" />
                      </div>
                      <span class="row-text">
                        <span class="row-title">{tr.title}</span>
                        <span class="row-sub">{[tr.artist, tr.stationName].filter(Boolean).join(' · ')}</span>
                      </span>
                      <span class="row-time">{formatTime(tr.identifiedAt)}</span>
                    </button>
                  ) : (
                    <TrackRow track={tr} />
                  ),
                )}
              </div>
            </section>
          ))}
          {!filtered.length && <EmptyState icon="search" title={t('noResults')} text={`« ${q} »`} />}
          {editing && (
            <div class="edit-bar">
              <button class="text-btn danger" disabled={!selected.size} onClick={() => (deleteTracks([...selected]), setSelected(new Set()))}>
                {t('delete')} {selected.size ? `(${selected.size})` : ''}
              </button>
              <button
                class="text-btn danger"
                onClick={() => {
                  if (confirm('Effacer tout l’historique musical ?')) {
                    clearHistory();
                    setEditing(false);
                  }
                }}
              >
                Tout effacer
              </button>
            </div>
          )}
        </>
      )}
    </Screen>
  );
}
