/** Explorer : genres, pays et playlists. */
import { useMemo, useState } from 'preact/hooks';
import { useSelector } from '../../core/store';
import { store } from '../../app/state';
import { openSheet, push } from '../../app/nav';
import { categoryFacets, countryFacets, searchStations, visibleStations, type Facet } from '../../app/selectors';
import { hash } from '../../services/m3u/normalize';
import { plural, t } from '../../i18n';
import { Artwork } from '../components/Artwork';
import { Icon } from '../components/Icon';
import { StationList } from '../components/Station';
import { EmptyState, Screen, SearchField, Segmented } from '../components/UI';

/** Dégradés choisis à la main : profonds, jamais criards. */
const PALETTE: [string, string][] = [
  ['#5b3cc4', '#2a1a6e'],
  ['#c2410c', '#6d1d0e'],
  ['#0f766e', '#0a3b3a'],
  ['#1d4ed8', '#10235e'],
  ['#be185d', '#5c0f33'],
  ['#4d7c0f', '#1f3a0a'],
  ['#a16207', '#4a2c06'],
  ['#7e22ce', '#3b0d63'],
  ['#0369a1', '#0c2a4a'],
  ['#b91c1c', '#4c0d0d'],
];
/** Couleurs choisies par thème ; sinon dégradé stable dérivé du nom. */
const THEMES: [RegExp, [string, string]][] = [
  [/jazz|soul|funk|blues/i, ['#b45309', '#3f1d06']],
  [/classique|classical|opéra|opera/i, ['#a16207', '#2b1d05']],
  [/électro|electro|dance|techno|house/i, ['#7c3aed', '#1e0b4b']],
  [/rock|metal/i, ['#b91c1c', '#2a0707']],
  [/rap|r&b|hip.?hop|urban/i, ['#db2777', '#3b0a24']],
  [/hits|pop/i, ['#e11d48', '#4a0a1e']],
  [/chill|lounge|ambient/i, ['#0d9488', '#062b29']],
  [/monde|world|afro|latin/i, ['#059669', '#06291e']],
  [/info|talk|news|actu/i, ['#2563eb', '#0b1c48']],
  [/années|60|70|80|90|oldies|rétro/i, ['#ea580c', '#3b1405']],
  [/chanson|française|french/i, ['#1d4ed8', '#4c0519']],
  [/religi|chrét|gospel|spirit/i, ['#6d28d9', '#1f0b3d']],
  [/locale|région/i, ['#16a34a', '#082a14']],
  [/éclectique|eclectic|variété/i, ['#c026d3', '#2e0a33']],
  [/indé|indie|community/i, ['#4f46e5', '#14123d']],
  [/nts/i, ['#3f3f46', '#09090b']],
  [/rmc|sport/i, ['#0369a1', '#3b0a0a']],
  [/autres|other|divers/i, ['#52525b', '#18181b']],
];
const gradientFor = (key: string) => THEMES.find(([re]) => re.test(key))?.[1] ?? PALETTE[parseInt(hash(key), 36) % PALETTE.length];

export function GenreCards({ facets, kind }: { facets: Facet[]; kind: 'group' | 'genre' | 'country' }) {
  return (
    <div class="cat-grid">
      {facets.map((f) => {
        const [c1, c2] = gradientFor(f.key);
        return (
          <button
            class="cat-card"
            style={{ '--cat-1': c1, '--cat-2': c2 } as any}
            onClick={() => push({ type: 'collection', kind, value: f.key, title: f.label })}
          >
            <span class="cat-name">{f.label}</span>
            <span class="cat-count">{plural(f.count, 'stationsOne', 'stationsMany')}</span>
            <span class="cat-logos">
              {f.logos.map((l, i) => (
                <span style={{ '--i': i } as any}>
                  <Artwork src={l} name={f.label + i} size="xs" rounded="sm" logo />
                </span>
              ))}
            </span>
          </button>
        );
      })}
    </div>
  );
}

type Facets = 'genres' | 'countries' | 'playlists';

export function Explore() {
  const [q, setQ] = useState('');
  const [mode, setMode] = useState<Facets>('genres');
  const d = useSelector(store, (s) => ({ genres: categoryFacets(s), countries: countryFacets(s), playlists: s.playlists, stations: visibleStations(s) }));
  const results = useMemo(() => (q ? searchStations(d.stations, q) : []), [q, d.stations]);

  return (
    <Screen title={t('tabExplore')}>
      <div class="pad stack">
        <SearchField value={q} onInput={setQ} placeholder={t('searchPlaceholder')} />
        {!q && (
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'genres', label: 'Catégories' },
              { value: 'countries', label: t('countries') },
              { value: 'playlists', label: t('playlists') },
            ]}
          />
        )}
      </div>
      {q ? (
        results.length ? (
          <StationList stations={results} />
        ) : (
          <EmptyState icon="search" title={t('noResults')} text={`« ${q} »`} />
        )
      ) : mode === 'genres' ? (
        d.genres.length ? (
          <GenreCards facets={d.genres} kind="group" />
        ) : (
          <EmptyState icon="note" title="Aucun genre" text="Les genres proviennent de l’attribut group-title de vos playlists." />
        )
      ) : mode === 'countries' ? (
        d.countries.length ? (
          <GenreCards facets={d.countries} kind="country" />
        ) : (
          <EmptyState icon="globe" title="Aucun pays détecté" text="Les pays proviennent des attributs tvg-country, tvg-id ou du groupe de vos playlists." />
        )
      ) : (
        <div class="pad">
          <div class="group-body">
            {d.playlists.map((p) => (
              <button class="cell" onClick={() => push({ type: 'collection', kind: 'playlist', value: p.id, title: p.name })}>
                <span class="cell-icon" style={{ background: 'var(--accent-gradient)' }}>
                  <Icon name="doc" size={18} />
                </span>
                <span class="cell-label">{p.name}</span>
                <span class="cell-detail">{p.stationIds.length}</span>
                <Icon name="chevron" size={16} class="cell-chevron" />
              </button>
            ))}
            <button class="cell" onClick={() => openSheet({ type: 'import' })}>
              <span class="cell-icon accent">
                <Icon name="plus" size={18} />
              </span>
              <span class="cell-label accent-text">{t('importPlaylist')}</span>
            </button>
          </div>
        </div>
      )}
    </Screen>
  );
}
