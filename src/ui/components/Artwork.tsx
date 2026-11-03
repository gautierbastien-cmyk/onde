/**
 * Visuel d'une station ou d'un morceau. Sans image (ou image cassée) :
 * monogramme sur un dégradé dérivé du nom, jamais une case vide.
 */
import { useState } from 'preact/hooks';
import { colorFromString } from '../../services/artwork/colors';

function initials(name: string) {
  const words = name
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w && !/^(radio|the|la|le|les|fm)$/i.test(w));
  const w = words.length ? words : name.split(/\s+/);
  return (w.length > 1 ? w[0][0] + w[1][0] : (w[0] ?? '?').slice(0, 2)).toUpperCase();
}

interface Props {
  src?: string;
  name: string;
  size?: 'xs' | 's' | 'm' | 'l' | 'xl' | 'fill';
  rounded?: 'sm' | 'md' | 'lg' | 'xl';
  /** Logo de station : affiché « contenu » sur fond neutre plutôt que recadré. */
  logo?: boolean;
  class?: string;
}

export function Artwork({ src, name, size = 'm', rounded = 'md', logo = false, class: cls = '' }: Props) {
  const [failed, setFailed] = useState<string | null>(null);
  const ok = src && failed !== src;
  const [r, g, b] = colorFromString(name);
  return (
    <div
      class={`art art-${size} r-${rounded} ${logo && ok ? 'is-logo' : ''} ${cls}`}
      style={{ '--art-rgb': `${r} ${g} ${b}` } as any}
    >
      {ok ? (
        <img src={src} alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" draggable={false} onError={() => setFailed(src!)} />
      ) : (
        <span class="art-mono">{initials(name)}</span>
      )}
    </div>
  );
}

/** Indicateur d'état « en lecture » (barres animées) : il reflète l'état du lecteur, pas le signal audio. */
export function EqBars({ active, class: cls = '' }: { active: boolean; class?: string }) {
  return (
    <span class={`eq ${active ? 'on' : ''} ${cls}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}
