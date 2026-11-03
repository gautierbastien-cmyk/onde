/** Store minimal : état immuable, abonnements, hook Preact avec sélecteur. */
import { useEffect, useRef, useState } from 'preact/hooks';

export interface Store<S> {
  get(): S;
  set(patch: Partial<S> | ((s: S) => Partial<S>)): void;
  subscribe(fn: (s: S) => void): () => void;
}

export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<(s: S) => void>();
  return {
    get: () => state,
    set(patch) {
      const p = typeof patch === 'function' ? patch(state) : patch;
      state = { ...state, ...p };
      for (const l of listeners) l(state);
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || !a || !b) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  return ka.every((k) => Object.is((a as any)[k], (b as any)[k]));
}

export function useSelector<S extends object, T>(store: Store<S>, selector: (s: S) => T): T {
  const [value, setValue] = useState(() => selector(store.get()));
  const sel = useRef(selector);
  sel.current = selector;
  const last = useRef(value);
  useEffect(() => {
    const check = (s: S) => {
      const next = sel.current(s);
      if (!shallowEqual(next, last.current)) {
        last.current = next;
        setValue(next);
      }
    };
    check(store.get());
    return store.subscribe(check);
  }, [store]);
  return value;
}
