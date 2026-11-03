/** Jeu d'icônes minimalistes (trait 1,8 px, grille 24), dans l'esprit SF Symbols. */
import type { JSX } from 'preact';

const paths = {
  home: <path d="M4 10.5 12 4l8 6.5V19a1.5 1.5 0 0 1-1.5 1.5H15v-5.5h-6v5.5H5.5A1.5 1.5 0 0 1 4 19z" />,
  explore: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </>
  ),
  library: (
    <>
      <rect x="3.5" y="8" width="17" height="12.5" rx="2.5" />
      <path d="M6 5.25h12M8.5 2.75h7" />
    </>
  ),
  heart: <path d="M12 20s-7.5-4.6-7.5-10.1A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.5 2.7C19.5 15.4 12 20 12 20z" />,
  heartFill: <path fill="currentColor" stroke="none" d="M12 20.6c-.2 0-.4-.1-.6-.2C10.3 19.7 3.6 15.2 3.6 9.9a5 5 0 0 1 8.4-3.6 5 5 0 0 1 8.4 3.6c0 5.3-6.7 9.8-7.8 10.5-.2.1-.4.2-.6.2z" />,
  play: <path fill="currentColor" stroke="none" d="M7.5 4.9v14.2c0 .9 1 1.4 1.7.9l11-7.1c.7-.4.7-1.4 0-1.8l-11-7.1c-.7-.5-1.7 0-1.7.9z" />,
  pause: (
    <>
      <rect fill="currentColor" stroke="none" x="6" y="4.5" width="4.2" height="15" rx="1.2" />
      <rect fill="currentColor" stroke="none" x="13.8" y="4.5" width="4.2" height="15" rx="1.2" />
    </>
  ),
  prev: <path fill="currentColor" stroke="none" d="M11.2 6.3v4.4l7.4-4.9c.6-.4 1.4 0 1.4.8v10.8c0 .8-.8 1.2-1.4.8l-7.4-4.9v4.4c0 .8-.8 1.2-1.4.8L2 13.3a1 1 0 0 1 0-1.6l7.8-6.2c.6-.4 1.4 0 1.4.8z" />,
  next: <path fill="currentColor" stroke="none" d="M12.8 6.3v4.4L5.4 5.8C4.8 5.4 4 5.8 4 6.6v10.8c0 .8.8 1.2 1.4.8l7.4-4.9v4.4c0 .8.8 1.2 1.4.8l7.8-6.2a1 1 0 0 0 0-1.6l-7.8-6.2c-.6-.4-1.4 0-1.4.8z" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m15.5 15.5 5 5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  more: (
    <>
      <circle fill="currentColor" stroke="none" cx="5.5" cy="12" r="1.6" />
      <circle fill="currentColor" stroke="none" cx="12" cy="12" r="1.6" />
      <circle fill="currentColor" stroke="none" cx="18.5" cy="12" r="1.6" />
    </>
  ),
  back: <path d="M15 4.5 7.5 12l7.5 7.5" />,
  chevron: <path d="m9.5 5.5 6.5 6.5-6.5 6.5" />,
  down: <path d="m5.5 9 6.5 6.5L18.5 9" />,
  airplay: (
    <>
      <path d="M6.5 17H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-1.5" />
      <path fill="currentColor" stroke="none" d="M12 14.2 17 20.5H7z" />
    </>
  ),
  moon: <path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  trash: <path d="M4.5 6.5h15M9.5 6.5V4.8c0-.7.5-1.3 1.2-1.3h2.6c.7 0 1.2.6 1.2 1.3v1.7M6.5 6.5l.9 12.6c.1 1 .9 1.9 2 1.9h5.2c1 0 1.9-.8 2-1.9l.9-12.6" />,
  eyeOff: (
    <>
      <path d="M3 3l18 18M10.6 5.6A9.9 9.9 0 0 1 12 5.5c5.2 0 8.7 4.6 9.5 6.5-.4 1-1.4 2.6-3 4M6.4 7.6C4.5 9 3.1 10.8 2.5 12c.8 1.9 4.3 6.5 9.5 6.5 1.6 0 3-.4 4.2-1.1" />
      <path d="M9.9 10a3 3 0 0 0 4.1 4.1" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12c.8-1.9 4.3-6.5 9.5-6.5s8.7 4.6 9.5 6.5c-.8 1.9-4.3 6.5-9.5 6.5S3.3 13.9 2.5 12z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6" />
      <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6" />
      <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6" />
    </>
  ),
  list: <path d="M8.5 6.5h12M8.5 12h12M8.5 17.5h12M4 6.5h.01M4 12h.01M4 17.5h.01" />,
  wave: <path d="M3 12h1.5M6.5 8v8M10 5v14M13.5 9v6M17 6.5v11M20.5 10.5v3" />,
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a7.7 7.7 0 0 0 0-3l2-1.6-2-3.4-2.4 1a7.6 7.6 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.5A7.6 7.6 0 0 0 7 6.5l-2.4-1-2 3.4 2 1.6a7.7 7.7 0 0 0 0 3l-2 1.6 2 3.4 2.4-1a7.6 7.6 0 0 0 2.6 1.5l.4 2.5h4l.4-2.5a7.6 7.6 0 0 0 2.6-1.5l2.4 1 2-3.4z" />
    </>
  ),
  note: (
    <>
      <path d="M9 18V5.5l11-2v12.2" />
      <circle cx="6.5" cy="18" r="2.5" />
      <circle cx="17.5" cy="15.7" r="2.5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  radio: (
    <>
      <rect x="3" y="8" width="18" height="12" rx="2.5" />
      <path d="m7 8 9.5-4.5" />
      <circle cx="15.5" cy="14" r="2.5" />
      <path d="M6.5 12.5h3M6.5 15.5h3" />
    </>
  ),
  globe: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.3 2.3 3.5 5.2 3.5 8.5s-1.2 6.2-3.5 8.5c-2.3-2.3-3.5-5.2-3.5-8.5S9.7 5.8 12 3.5z" />
    </>
  ),
  doc: (
    <>
      <path d="M14 3.5H7.5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V8z" />
      <path d="M14 3.5V8h4.5M9 13h6M9 16.5h4" />
    </>
  ),
  link: <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  refresh: <path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4" />,
  drag: <path d="M5 9h14M5 15h14" />,
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.5M12 7.8v.01" />
    </>
  ),
  external: <path d="M14 4.5h5.5V10M19.5 4.5 11 13M17 13.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V8.5A1.5 1.5 0 0 1 6 7h4.5" />,
  share: <path d="M12 3.5v11M8 7.5l4-4 4 4M6.5 11H6a1.5 1.5 0 0 0-1.5 1.5V19A1.5 1.5 0 0 0 6 20.5h12a1.5 1.5 0 0 0 1.5-1.5v-6.5A1.5 1.5 0 0 0 18 11h-.5" />,
  sort: <path d="M7 4.5v15M3.5 8 7 4.5 10.5 8M17 19.5v-15M13.5 16l3.5 3.5 3.5-3.5" />,
  warning: <path d="M12 4 2.8 19.5h18.4zM12 10v4.5M12 17v.01" />,
} satisfies Record<string, JSX.Element>;

export type IconName = keyof typeof paths;

export function Icon({ name, size = 24, class: cls = '', label }: { name: IconName; size?: number; class?: string; label?: string }) {
  return (
    <svg
      class={`icon ${cls}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden={label ? undefined : 'true'}
      aria-label={label}
      role={label ? 'img' : undefined}
    >
      {paths[name]}
    </svg>
  );
}
