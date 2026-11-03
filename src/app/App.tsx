import { useSelector } from '../core/store';
import { nav, type Route, type Tab } from './nav';
import { store } from './state';
import { Home } from '../ui/screens/Home';
import { Explore } from '../ui/screens/Explore';
import { Collection, Favorites, Library } from '../ui/screens/Library';
import { History } from '../ui/screens/History';
import { Playlists } from '../ui/screens/Playlists';
import { Settings } from '../ui/screens/Settings';
import { NowPlaying } from '../ui/screens/NowPlaying';
import { MiniPlayer, TabBar } from '../ui/components/Player';
import { ImportBanner, SheetHost } from '../ui/sheets/Sheets';

const ROOTS: Record<Tab, () => preact.JSX.Element> = { home: Home, explore: Explore, library: Library, favorites: Favorites };

function renderRoute(r: Route) {
  switch (r.type) {
    case 'collection':
      return <Collection kind={r.kind} value={r.value} title={r.title} />;
    case 'history':
      return <History />;
    case 'playlists':
      return <Playlists />;
    case 'settings':
      return <Settings />;
  }
}

function Stack({ tab }: { tab: Tab }) {
  const stack = useSelector(nav, (s) => s.stacks[tab]);
  const Root = ROOTS[tab];
  return (
    <>
      <div class={`layer ${stack.length ? 'covered' : ''}`} inert={stack.length > 0}>
        <Root />
      </div>
      {stack.map((r, i) => (
        <div key={i + r.type} class={`layer pushed ${i < stack.length - 1 ? 'covered' : ''}`} inert={i < stack.length - 1}>
          {renderRoute(r)}
        </div>
      ))}
    </>
  );
}

function Toast() {
  const toast = useSelector(store, (s) => s.toast);
  return (
    <div class={`toast ${toast ? 'show' : ''}`} role="status" aria-live="polite">
      {toast?.text}
    </div>
  );
}

export function App() {
  const tab = useSelector(nav, (s) => s.tab);
  const hasPlayer = useSelector(store, (s) => !!(s.player.stationId ?? s.lastStationId));
  return (
    <div class={`app ${hasPlayer ? 'with-mini' : ''}`}>
      <main class="screens">
        {(Object.keys(ROOTS) as Tab[]).map((id) => (
          <section class={`screen ${tab === id ? 'active' : ''}`} key={id} inert={tab !== id}>
            <Stack tab={id} />
          </section>
        ))}
      </main>
      <ImportBanner />
      <div class="dock">
        <MiniPlayer />
        <TabBar />
      </div>
      <NowPlaying />
      <SheetHost />
      <Toast />
    </div>
  );
}
