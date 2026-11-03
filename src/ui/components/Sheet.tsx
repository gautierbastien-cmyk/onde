/** Feuille modale iOS : glisse depuis le bas, se ferme en la tirant vers le bas. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';

export function Sheet({
  children,
  onClose,
  title,
  size = 'auto',
  actions,
}: {
  children: ComponentChildren;
  onClose: () => void;
  title?: string;
  size?: 'auto' | 'large';
  actions?: ComponentChildren;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [closing, setClosing] = useState(false);
  const drag = useRef<{ y: number; dy: number; t: number } | null>(null);

  const close = () => {
    setClosing(true);
    setTimeout(onClose, 260);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const onDown = (e: PointerEvent) => {
    const body = panel.current?.querySelector('.sheet-body');
    if (body && body.scrollTop > 0 && !(e.target as HTMLElement).closest('.sheet-grabber, .sheet-head')) return;
    drag.current = { y: e.clientY, dy: 0, t: Date.now() };
  };
  const onMove = (e: PointerEvent) => {
    if (!drag.current || !panel.current) return;
    const dy = Math.max(0, e.clientY - drag.current.y);
    drag.current.dy = dy;
    if (dy > 4) {
      panel.current.style.transition = 'none';
      panel.current.style.transform = `translateY(${dy}px)`;
    }
  };
  const onUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !panel.current) return;
    panel.current.style.transition = '';
    const velocity = d.dy / Math.max(1, Date.now() - d.t);
    if (d.dy > 120 || velocity > 0.6) close();
    else panel.current.style.transform = '';
  };

  return (
    <div class={`sheet-layer ${closing ? 'closing' : ''}`}>
      <div class="sheet-backdrop" onClick={close} />
      <div
        class={`sheet sheet-${size}`}
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
      >
        <div class="sheet-grabber" />
        {(title || actions) && (
          <div class="sheet-head">
            <h2>{title}</h2>
            <div class="sheet-actions">
              {actions}
              <button class="icon-btn round" onClick={close} aria-label="Fermer">
                <Icon name="close" size={16} />
              </button>
            </div>
          </div>
        )}
        <div class="sheet-body">{children}</div>
      </div>
    </div>
  );
}
