/** Navigation : 4 onglets, une pile d'écrans par onglet, des feuilles modales. */
import { createStore } from '../core/store';

export type Tab = 'home' | 'explore' | 'library' | 'favorites';

export type Route =
  | { type: 'collection'; kind: 'group' | 'genre' | 'country' | 'playlist' | 'all' | 'recents' | 'hidden'; value: string; title: string }
  | { type: 'history' }
  | { type: 'playlists' }
  | { type: 'settings' };

export type Sheet =
  | { type: 'import' }
  | { type: 'importUrl'; replaceId?: string }
  | { type: 'importReport'; outcomes: import('./state').ImportOutcome[] }
  | { type: 'station'; id: string }
  | { type: 'track'; id: string }
  | { type: 'sleep' }
  | { type: 'install' }
  | { type: 'rename'; kind: 'station' | 'playlist'; id: string; value: string };

export interface NavState {
  tab: Tab;
  stacks: Record<Tab, Route[]>;
  sheets: Sheet[];
  nowPlaying: boolean;
}

export const nav = createStore<NavState>({
  tab: 'home',
  stacks: { home: [], explore: [], library: [], favorites: [] },
  sheets: [],
  nowPlaying: false,
});

export function selectTab(tab: Tab) {
  const s = nav.get();
  // Toucher l'onglet actif revient à la racine, comme sur iOS.
  if (s.tab === tab) nav.set({ stacks: { ...s.stacks, [tab]: [] } });
  else nav.set({ tab });
  document.querySelector('.screen.active .scroller')?.scrollTo({ top: 0, behavior: s.tab === tab ? 'smooth' : 'auto' });
}

export function push(route: Route) {
  const s = nav.get();
  nav.set({ stacks: { ...s.stacks, [s.tab]: [...s.stacks[s.tab], route] } });
}

export function pop() {
  const s = nav.get();
  nav.set({ stacks: { ...s.stacks, [s.tab]: s.stacks[s.tab].slice(0, -1) } });
}

export function openSheet(sheet: Sheet) {
  const { sheets } = nav.get();
  const top = sheets[sheets.length - 1];
  if (top && JSON.stringify(top) === JSON.stringify(sheet)) return;
  nav.set((s) => ({ sheets: [...s.sheets, sheet] }));
}

export function closeSheet() {
  nav.set((s) => ({ sheets: s.sheets.slice(0, -1) }));
}

export function replaceSheet(sheet: Sheet) {
  nav.set((s) => ({ sheets: [...s.sheets.slice(0, -1), sheet] }));
}

export const openNowPlaying = () => nav.set({ nowPlaying: true });
export const closeNowPlaying = () => nav.set({ nowPlaying: false });
