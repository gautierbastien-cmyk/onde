/** Feuilles modales : import, rapport, station, morceau, minuteur, installation, renommage. */
import { useState } from 'preact/hooks';
import { useSelector } from '../../core/store';
import type { ImportReport } from '../../core/types';
import {
  deleteTracks,
  importFiles,
  importFromUrl,
  playStation,
  removeRecent,
  renamePlaylist,
  renameStation,
  setSleepTimer,
  store,
  toast,
  toggleFavorite,
  toggleHidden,
  type ImportOutcome,
} from '../../app/state';
import { closeSheet, nav, openNowPlaying, replaceSheet, type Sheet as SheetRoute } from '../../app/nav';
import { verificationLabel } from '../../services/m3u/importer';
import { DEFAULT_PLAYLISTS } from '../../config';
import { countryName, formatDateTime, t } from '../../i18n';
import { Artwork } from '../components/Artwork';
import { Icon } from '../components/Icon';
import { Sheet } from '../components/Sheet';
import { Button, Cell, Group } from '../components/UI';
import { spotifyLink } from '../components/spotify';

const ACCEPT = '.m3u,.m3u8,audio/x-mpegurl,audio/mpegurl,application/x-mpegurl,application/vnd.apple.mpegurl';

function ImportProgressView() {
  const p = useSelector(store, (s) => s.importProgress);
  if (!p) return null;
  const pct = p.total ? Math.round((p.done / p.total) * 100) : 0;
  return (
    <div class="import-progress">
      <span class="spinner" />
      <div class="import-progress-text">
        <strong>{p.label}</strong>
        <span>{p.total ? t('verifying', { done: p.done, total: p.total }) : t('importing')}</span>
        {p.total > 0 && (
          <div class="progress">
            <span style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      {p.total > 0 && (
        <button class="text-btn" onClick={p.cancel}>
          {t('skipVerification')}
        </button>
      )}
    </div>
  );
}

function ImportSheet() {
  const busy = useSelector(store, (s) => !!s.importProgress);
  const imported = useSelector(store, (s) => s.playlists.map((p) => p.source.ref));
  const onFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const outcomes = await importFiles([...list]);
    replaceSheet({ type: 'importReport', outcomes });
  };
  return (
    <Sheet title={t('importPlaylist')} onClose={closeSheet}>
      {busy ? (
        <ImportProgressView />
      ) : (
        <>
          <p class="sheet-lead">Formats .m3u et .m3u8. Seuls les flux radio audio sont conservés : les chaînes TV et vidéos sont écartées automatiquement.</p>
          <label class="import-option">
            <span class="import-option-icon" style={{ background: 'linear-gradient(135deg,#30b0c7,#0a84ff)' }}>
              <Icon name="doc" size={24} />
            </span>
            <span class="import-option-text">
              <strong>{t('importFromFiles')}</strong>
              <span>iCloud Drive, Sur mon iPhone, AirDrop… Sélection multiple possible.</span>
            </span>
            <Icon name="chevron" size={16} class="cell-chevron" />
            <input type="file" accept={ACCEPT} multiple hidden onChange={(e) => onFiles((e.target as HTMLInputElement).files)} />
          </label>
          <button class="import-option" onClick={() => replaceSheet({ type: 'importUrl' })}>
            <span class="import-option-icon" style={{ background: 'linear-gradient(135deg,#5e5ce6,#bf5af2)' }}>
              <Icon name="link" size={24} />
            </span>
            <span class="import-option-text">
              <strong>{t('importFromUrl')}</strong>
              <span>Actualisable en un geste par la suite.</span>
            </span>
            <Icon name="chevron" size={16} class="cell-chevron" />
          </button>
          {DEFAULT_PLAYLISTS.filter((d) => !imported.includes(d.url)).map((d) => (
            <button
              class="import-option"
              onClick={async () => replaceSheet({ type: 'importReport', outcomes: [await importFromUrl(d.url, undefined, d.name)] })}
            >
              <span class="import-option-icon" style={{ background: 'var(--accent-gradient)' }}>
                <Icon name="radio" size={24} />
              </span>
              <span class="import-option-text">
                <strong>{d.name}</strong>
                <span>Votre playlist, depuis GitHub</span>
              </span>
              <Icon name="chevron" size={16} class="cell-chevron" />
            </button>
          ))}
          <label class="link-btn center small">
            Fichier grisé dans le sélecteur ? Choisir parmi tous les fichiers
            <input type="file" multiple hidden onChange={(e) => onFiles((e.target as HTMLInputElement).files)} />
          </label>
        </>
      )}
    </Sheet>
  );
}

function ImportUrlSheet({ replaceId }: { replaceId?: string }) {
  const [url, setUrl] = useState('');
  const busy = useSelector(store, (s) => !!s.importProgress);
  const replace = useSelector(store, (s) => s.playlists.find((p) => p.id === replaceId));
  const go = async () => {
    try {
      new URL(url);
    } catch {
      return toast('Adresse invalide');
    }
    const outcome = await importFromUrl(url.trim(), replace);
    replaceSheet({ type: 'importReport', outcomes: [outcome] });
  };
  return (
    <Sheet title={t('importFromUrl')} onClose={closeSheet}>
      {busy ? (
        <ImportProgressView />
      ) : (
        <>
          <p class="sheet-lead">Le serveur doit autoriser le téléchargement depuis un navigateur (c’est le cas de GitHub, GitLab, Gist…). Sinon, enregistrez le fichier dans Fichiers puis importez-le.</p>
          <div class="cell cell-input boxed">
            <input type="url" inputMode="url" placeholder="https://…/radios.m3u" value={url} onInput={(e) => setUrl((e.target as HTMLInputElement).value)} autocomplete="off" autocapitalize="off" spellcheck={false} autoFocus />
          </div>
          <Button icon="plus" onClick={go} disabled={!url} class="full">
            Importer
          </Button>
        </>
      )}
    </Sheet>
  );
}

function ReportBlock({ name, report, error }: { name: string; report?: ImportReport; error?: string }) {
  const [open, setOpen] = useState<'excluded' | 'invalid' | null>(null);
  if (error || !report)
    return (
      <div class="report error">
        <h3>{name}</h3>
        <p class="report-error">
          <Icon name="warning" size={18} /> {error}
        </p>
      </div>
    );
  return (
    <div class="report">
      <h3>{name}</h3>
      <div class="report-stats">
        <div class="stat ok">
          <strong>{report.kept}</strong>
          <span>radios conservées</span>
        </div>
        <div class="stat">
          <strong>{report.excluded.length}</strong>
          <span>TV / vidéo écartées</span>
        </div>
        <div class="stat">
          <strong>{report.duplicates}</strong>
          <span>doublons</span>
        </div>
        <div class="stat">
          <strong>{report.invalid.length}</strong>
          <span>entrées invalides</span>
        </div>
      </div>
      <p class="footnote">
        {report.totalEntries} entrées analysées en {(report.durationMs / 1000).toLocaleString('fr', { maximumFractionDigits: 1 })} s
        {report.added || report.updated ? ` · ${report.added} nouvelles, ${report.updated} mises à jour` : ''}
        {report.unverified ? ` · ${report.unverified} reconnues comme radios d’après la playlist, ${report.kept - report.unverified} confirmées par le serveur` : ''}
      </p>
      {report.excluded.length > 0 && (
        <button class="disclosure" onClick={() => setOpen(open === 'excluded' ? null : 'excluded')}>
          Voir les entrées écartées <Icon name={open === 'excluded' ? 'down' : 'chevron'} size={16} />
        </button>
      )}
      {open === 'excluded' && (
        <ul class="report-list">
          {report.excluded.slice(0, 300).map((e) => (
            <li>
              <strong>{e.name}</strong>
              <span>{e.reason}</span>
            </li>
          ))}
        </ul>
      )}
      {report.invalid.length > 0 && (
        <button class="disclosure" onClick={() => setOpen(open === 'invalid' ? null : 'invalid')}>
          Voir les entrées invalides <Icon name={open === 'invalid' ? 'down' : 'chevron'} size={16} />
        </button>
      )}
      {open === 'invalid' && (
        <ul class="report-list">
          {report.invalid.slice(0, 300).map((e) => (
            <li>
              <strong>
                Ligne {e.line} · {e.name}
              </strong>
              <span>{e.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ImportReportSheet({ outcomes }: { outcomes: ImportOutcome[] }) {
  return (
    <Sheet title="Rapport d’importation" onClose={closeSheet} size="large">
      {outcomes.map((o) => (
        <ReportBlock {...o} />
      ))}
      <Button onClick={closeSheet} class="full">
        {t('done')}
      </Button>
    </Sheet>
  );
}

function StationSheet({ id }: { id: string }) {
  const d = useSelector(store, (s) => ({
    st: s.byId.get(id),
    fav: s.favorites.includes(id),
    hidden: s.hidden.includes(id),
    recent: s.recents.some((r) => r.stationId === id),
    playing: s.player.stationId === id && s.player.status !== 'paused' && s.player.status !== 'error',
    playlists: s.playlists.filter((p) => s.byId.get(id)?.playlistIds.includes(p.id)).map((p) => p.name),
  }));
  const [showAttrs, setShowAttrs] = useState(false);
  const st = d.st;
  if (!st) return null;
  return (
    <Sheet onClose={closeSheet}>
      <div class="station-head">
        <Artwork src={st.logo} name={st.name} size="l" rounded="lg" logo />
        <div>
          <h2>{st.name}</h2>
          <p>{[st.country && countryName(st.country), ...st.genres].filter(Boolean).join(' · ')}</p>
        </div>
      </div>
      <div class="action-row">
        <button
          onClick={() => {
            playStation(id);
            closeSheet();
            if (!d.playing) openNowPlaying();
          }}
        >
          <Icon name={d.playing ? 'pause' : 'play'} size={22} />
          {d.playing ? 'Pause' : 'Lire'}
        </button>
        <button class={d.fav ? 'on' : ''} onClick={() => toggleFavorite(id)}>
          <Icon name={d.fav ? 'heartFill' : 'heart'} size={22} />
          {d.fav ? 'Favori' : 'Ajouter'}
        </button>
        <button onClick={() => toggleHidden(id)}>
          <Icon name={d.hidden ? 'eye' : 'eyeOff'} size={22} />
          {d.hidden ? 'Afficher' : 'Masquer'}
        </button>
        <button onClick={() => replaceSheet({ type: 'rename', kind: 'station', id, value: st.name })}>
          <Icon name="doc" size={22} />
          {t('rename')}
        </button>
      </div>
      {d.recent && (
        <Button
          variant="danger"
          icon="clock"
          class="full"
          onClick={() => {
            removeRecent(id);
            closeSheet();
          }}
        >
          Retirer des radios récemment écoutées
        </Button>
      )}
      <Group>
        <Cell label="Vérification" detail={verificationLabel[st.verification]} />
        <Cell label="Type de flux" detail={st.isHls ? 'HLS' : st.url.startsWith('http:') ? 'Direct · HTTP' : 'Direct · HTTPS'} />
        <Cell label="Playlists" detail={d.playlists.join(', ') || '—'} />
        <Cell
          label="Adresse du flux"
          detail={<span class="mono ellipsis">{st.url.replace(/^https?:\/\//, '')}</span>}
          onClick={() => navigator.clipboard?.writeText(st.url).then(() => toast('Adresse copiée'))}
        />
      </Group>
      {Object.keys(st.attrs).length > 0 && (
        <>
          <button class="disclosure" onClick={() => setShowAttrs(!showAttrs)}>
            Attributs de la playlist <Icon name={showAttrs ? 'down' : 'chevron'} size={16} />
          </button>
          {showAttrs && (
            <ul class="report-list mono">
              {Object.entries(st.attrs).map(([k, v]) => (
                <li>
                  <strong>{k}</strong>
                  <span>{v}</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Sheet>
  );
}

const SOURCE: Record<string, string> = {
  icy: 'Métadonnées ICY de la station',
  'hls-id3': 'Métadonnées ID3 du flux HLS',
  'icecast-status': 'Page d’état Icecast de la station',
  broadcaster: 'API publique Radio France',
  proxy: 'Métadonnées de la station via votre relais',
  'recognition:shazam': 'Reconnaissance audio Shazam',
};

function TrackSheet({ id }: { id: string }) {
  const tr = useSelector(store, (s) => s.tracks.find((x) => x.id === id) ?? (s.nowTrack?.id === id ? s.nowTrack : undefined));
  if (!tr) return null;
  const query = encodeURIComponent([tr.artist, tr.title].filter(Boolean).join(' '));
  return (
    <Sheet onClose={closeSheet}>
      <div class="track-head">
        <Artwork src={tr.artworkUrl} name={tr.artist || tr.title} size="xl" rounded="lg" />
        <h2>{tr.title}</h2>
        {tr.artist && <p class="track-artist">{tr.artist}</p>}
        {tr.album && <p class="track-album">{tr.album}</p>}
      </div>
      <div class="action-row">
        <a href={spotifyLink(tr)} class="spotify">
          <Icon name="spotify" size={22} />
          Spotify
        </a>
        <a href={`https://music.apple.com/search?term=${query}`} target="_blank" rel="noopener">
          <Icon name="external" size={22} />
          Apple Music
        </a>
        <button
          onClick={() => {
            closeSheet();
            playStation(tr.stationId);
          }}
        >
          <Icon name="radio" size={22} />
          Station
        </button>
        <button
          class="danger"
          onClick={() => {
            deleteTracks([tr.id]);
            closeSheet();
          }}
        >
          <Icon name="trash" size={22} />
          {t('delete')}
        </button>
      </div>
      <Group>
        <Cell label="Radio" detail={tr.stationName} />
        <Cell label="Entendu le" detail={formatDateTime(tr.identifiedAt, tr.timeZone)} />
        {tr.timeZone !== Intl.DateTimeFormat().resolvedOptions().timeZone && <Cell label="Fuseau d’origine" detail={tr.timeZone} />}
        <Cell label="Source" detail={SOURCE[tr.source] ?? tr.source} />
        {tr.enrichedBy && <Cell label="Pochette et album" detail={tr.enrichedBy === 'spotify' ? 'Spotify' : 'Catalogue Apple Music'} />}
        {tr.raw && <Cell label="Texte reçu" detail={<span class="mono ellipsis">{tr.raw}</span>} />}
      </Group>
    </Sheet>
  );
}

function SleepSheet() {
  const sleepAt = useSelector(store, (s) => s.sleepAt);
  const choose = (m: number | null) => {
    setSleepTimer(m);
    closeSheet();
  };
  return (
    <Sheet title="Minuteur de mise en veille" onClose={closeSheet}>
      <div class="sleep-grid">
        {[5, 15, 30, 45, 60, 90].map((m) => (
          <button onClick={() => choose(m)}>
            <strong>{m}</strong>
            <span>min</span>
          </button>
        ))}
      </div>
      {sleepAt && (
        <Button variant="secondary" class="full" onClick={() => choose(null)}>
          Désactiver le minuteur
        </Button>
      )}
      <p class="footnote">La lecture s’arrête à l’échéance, même écran verrouillé tant que la radio joue.</p>
    </Sheet>
  );
}

function InstallSheet() {
  const steps: [string, string][] = [
    ['globe', 'Ouvrez l’adresse d’Onde dans Safari.'],
    ['share', 'Touchez le bouton Partager (carré avec une flèche), en bas ou à côté de la barre d’adresse.'],
    ['plus', 'Choisissez « Sur l’écran d’accueil ». Sur iOS 26, laissez « Ouvrir en tant qu’app web » activé.'],
    ['radio', 'Touchez « Ajouter », puis lancez Onde depuis son icône : plein écran, sans barre d’adresse.'],
  ];
  return (
    <Sheet title="Installer Onde" onClose={closeSheet}>
      <ol class="install-steps">
        {steps.map(([icon, text], i) => (
          <li>
            <span class="install-num">{i + 1}</span>
            <Icon name={icon as any} size={22} />
            <span>{text}</span>
          </li>
        ))}
      </ol>
      <p class="footnote">Aucun App Store, aucun compte. Vos playlists, favoris et historique restent dans l’app installée (Safari et l’app installée ont des stockages séparés : importez vos playlists depuis l’app installée).</p>
    </Sheet>
  );
}

function RenameSheet({ kind, id, value }: { kind: 'station' | 'playlist'; id: string; value: string }) {
  const [v, setV] = useState(value);
  const save = async () => {
    if (!v.trim()) return;
    if (kind === 'station') await renameStation(id, v);
    else {
      const p = store.get().playlists.find((x) => x.id === id);
      if (p) await renamePlaylist(p, v.trim());
    }
    closeSheet();
  };
  return (
    <Sheet title={t('rename')} onClose={closeSheet}>
      <div class="cell cell-input boxed">
        <input value={v} onInput={(e) => setV((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === 'Enter' && save()} autoFocus />
      </div>
      <Button class="full" onClick={save}>
        Enregistrer
      </Button>
    </Sheet>
  );
}

function render(s: SheetRoute) {
  switch (s.type) {
    case 'import':
      return <ImportSheet />;
    case 'importUrl':
      return <ImportUrlSheet replaceId={s.replaceId} />;
    case 'importReport':
      return <ImportReportSheet outcomes={s.outcomes} />;
    case 'station':
      return <StationSheet id={s.id} />;
    case 'track':
      return <TrackSheet id={s.id} />;
    case 'sleep':
      return <SleepSheet />;
    case 'install':
      return <InstallSheet />;
    case 'rename':
      return <RenameSheet {...s} />;
  }
}

export function SheetHost() {
  const sheets = useSelector(nav, (s) => s.sheets);
  return <>{sheets.map((s, i) => <div key={i + s.type}>{render(s)}</div>)}</>;
}

/** Bandeau global quand une importation tourne alors que la feuille est fermée. */
export function ImportBanner() {
  const p = useSelector(store, (s) => s.importProgress);
  const sheetOpen = useSelector(nav, (s) => s.sheets.some((x) => x.type === 'import' || x.type === 'importUrl'));
  if (!p || sheetOpen) return null;
  return (
    <div class="import-banner">
      <ImportProgressView />
    </div>
  );
}

