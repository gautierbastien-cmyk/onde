/**
 * Internationalisation. Toute chaîne visible passe par t('clé').
 * Ajouter une langue = ajouter un dictionnaire de même forme que `fr`.
 */
import { fr } from './fr';

export type Messages = typeof fr;
export type MessageKey = keyof Messages;

const dictionaries: Record<string, Partial<Messages>> = { fr };
let locale = 'fr';

export function setLocale(l: string) {
  if (dictionaries[l]) locale = l;
  document.documentElement.lang = locale;
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let s = (dictionaries[locale]?.[key] ?? fr[key]) as string;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Pluriel simple : « 1 station » / « 3 stations ». */
export function plural(n: number, one: MessageKey, many: MessageKey) {
  return t(n > 1 ? many : one, { n: n.toLocaleString(locale) });
}

export const getLocale = () => locale;

const regionNames = new Map<string, Intl.DisplayNames>();
export function countryName(code?: string): string {
  if (!code) return '';
  let dn = regionNames.get(locale);
  if (!dn) regionNames.set(locale, (dn = new Intl.DisplayNames([locale], { type: 'region' })));
  try {
    return dn.of(code) ?? code;
  } catch {
    return code;
  }
}

export function flag(code?: string): string {
  if (!code || !/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
}

/** Dates dans le fuseau de l'appareil (Intl choisit automatiquement le fuseau courant). */
export function formatTime(ts: number) {
  return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(ts);
}

export function formatDay(ts: number) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(Date.now() - 86400_000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, today)) return t('today');
  if (same(d, yesterday)) return t('yesterday');
  return new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: d.getFullYear() === today.getFullYear() ? undefined : 'numeric' }).format(d);
}

export function formatDateTime(ts: number, timeZone?: string) {
  return new Intl.DateTimeFormat(locale, { dateStyle: 'full', timeStyle: 'short', timeZone }).format(ts);
}

export function relativeTime(ts: number) {
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  const diff = (ts - Date.now()) / 1000;
  const abs = Math.abs(diff);
  if (abs < 60) return rtf.format(Math.round(diff), 'second');
  if (abs < 3600) return rtf.format(Math.round(diff / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
  return rtf.format(Math.round(diff / 86400), 'day');
}

export function greeting(): MessageKey {
  const h = new Date().getHours();
  if (h < 5) return 'greetNight';
  if (h < 12) return 'greetMorning';
  if (h < 18) return 'greetAfternoon';
  return 'greetEvening';
}
