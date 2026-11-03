/** Gestion des playlists : actualiser, remplacer, renommer, supprimer, rapport. */
import { useRef } from 'preact/hooks';
import { useSelector } from '../../core/store';
import type { Playlist } from '../../core/types';
import { deletePlaylist, importFiles, importFromUrl, store } from '../../app/state';
import { openSheet, push } from '../../app/nav';
import { plural, relativeTime, t } from '../../i18n';
import { Icon } from '../components/Icon';
import { Button, EmptyState, Screen } from '../components/UI';

function PlaylistCard({ p }: { p: Playlist }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const busy = useSelector(store, (s) => !!s.importProgress);

  const replaceWithFile = async (files: FileList | null) => {
    if (!files?.length) return;
    const outcomes = await importFiles([files[0]], p);
    openSheet({ type: 'importReport', outcomes });
  };
  const refresh = async () => {
    if (p.source.type === 'url') openSheet({ type: 'importReport', outcomes: [await importFromUrl(p.source.ref, p)] });
    else fileInput.current?.click();
  };

  return (
    <div class="pl-card">
      <button class="pl-head" onClick={() => push({ type: 'collection', kind: 'playlist', value: p.id, title: p.name })}>
        <span class="pl-icon">
          <Icon name={p.source.type === 'url' ? 'link' : 'doc'} size={22} />
        </span>
        <span class="pl-text">
          <span class="pl-name">{p.name}</span>
          <span class="pl-meta">
            {plural(p.stationIds.length, 'stationsOne', 'stationsMany')} · mise à jour {relativeTime(p.updatedAt)}
          </span>
          <span class="pl-source">{p.source.ref}</span>
        </span>
        <Icon name="chevron" size={16} class="cell-chevron" />
      </button>
      <div class="pl-actions">
        <button disabled={busy} onClick={refresh}>
          <Icon name="refresh" size={18} />
          {p.source.type === 'url' ? 'Actualiser' : 'Remplacer'}
        </button>
        <button onClick={() => openSheet({ type: 'importReport', outcomes: [{ name: p.name, report: p.report }] })}>
          <Icon name="info" size={18} />
          Rapport
        </button>
        <button onClick={() => openSheet({ type: 'rename', kind: 'playlist', id: p.id, value: p.name })}>
          <Icon name="doc" size={18} />
          {t('rename')}
        </button>
        <button
          class="danger"
          onClick={() => confirm(`Supprimer « ${p.name} » et ses ${p.stationIds.length} stations (sauf celles présentes dans une autre playlist) ?`) && deletePlaylist(p)}
        >
          <Icon name="trash" size={18} />
          {t('delete')}
        </button>
      </div>
      <input ref={fileInput} type="file" accept=".m3u,.m3u8,audio/x-mpegurl,audio/mpegurl,application/vnd.apple.mpegurl,application/x-mpegurl,text/plain" hidden onChange={(e) => replaceWithFile((e.target as HTMLInputElement).files)} />
    </div>
  );
}

export function Playlists() {
  const playlists = useSelector(store, (s) => s.playlists);
  return (
    <Screen
      title={t('playlists')}
      back
      actions={
        <button class="icon-btn" onClick={() => openSheet({ type: 'import' })} aria-label={t('importPlaylist')}>
          <Icon name="plus" size={26} />
        </button>
      }
    >
      {playlists.length ? (
        <div class="pad stack">
          {playlists.map((p) => (
            <PlaylistCard key={p.id} p={p} />
          ))}
          <p class="footnote">
            Une station présente dans plusieurs playlists n’apparaît qu’une fois. Remplacer une playlist retire les stations qui n’y figurent plus ; vos favoris restent intacts pour les stations conservées.
          </p>
        </div>
      ) : (
        <EmptyState icon="doc" title="Aucune playlist" text={t('welcomeText')}>
          <Button icon="plus" onClick={() => openSheet({ type: 'import' })}>
            {t('importPlaylist')}
          </Button>
        </EmptyState>
      )}
    </Screen>
  );
}
