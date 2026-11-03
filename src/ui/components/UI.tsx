/** Composants génériques du design system. */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { Icon, type IconName } from './Icon';
import { pop } from '../../app/nav';

/** Écran avec grand titre façon iOS : la barre compacte apparaît au défilement. */
export function Screen({
  title,
  back,
  actions,
  children,
  subtitle,
}: {
  title: string;
  back?: boolean;
  actions?: ComponentChildren;
  children: ComponentChildren;
  subtitle?: ComponentChildren;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const el = ref.current!;
    const onScroll = () => setCompact(el.scrollTop > 44);
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, []);
  return (
    <div class="scroller" ref={ref}>
      <header class={`navbar ${compact ? 'compact' : ''}`}>
        <div class="navbar-side">
          {back && (
            <button class="nav-back" onClick={pop} aria-label="Retour">
              <Icon name="back" size={24} />
            </button>
          )}
        </div>
        <div class="navbar-title">{title}</div>
        <div class="navbar-side right">{actions}</div>
      </header>
      <div class="large-title-wrap">
        <h1 class="large-title">{title}</h1>
        {subtitle && <div class="large-subtitle">{subtitle}</div>}
      </div>
      <div class="screen-body">{children}</div>
    </div>
  );
}

export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div class="section-header">
      <h2>{title}</h2>
      {action && (
        <button class="link-btn" onClick={onAction}>
          {action}
          <Icon name="chevron" size={16} />
        </button>
      )}
    </div>
  );
}

export function SearchField({ value, onInput, placeholder, autoFocus }: { value: string; onInput: (v: string) => void; placeholder: string; autoFocus?: boolean }) {
  return (
    <label class="search">
      <Icon name="search" size={18} />
      <input
        type="search"
        enterkeyhint="search"
        autocomplete="off"
        autocorrect="off"
        spellcheck={false}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        onInput={(e) => onInput((e.target as HTMLInputElement).value)}
      />
      {value && (
        <button class="search-clear" onClick={() => onInput('')} aria-label="Effacer">
          <Icon name="close" size={14} />
        </button>
      )}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  const i = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div class="segmented" style={{ '--n': options.length, '--i': i } as any} role="tablist">
      <span class="segmented-thumb" />
      {options.map((o) => (
        <button role="tab" aria-selected={o.value === value} class={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, text, children }: { icon: IconName; title: string; text: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <div class="empty-icon">
        <Icon name={icon} size={30} />
      </div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children}
    </div>
  );
}

export function Button({
  children,
  icon,
  variant = 'primary',
  onClick,
  disabled,
  class: cls = '',
}: {
  children: ComponentChildren;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  onClick?: () => void;
  disabled?: boolean;
  class?: string;
}) {
  return (
    <button class={`btn btn-${variant} ${cls}`} onClick={onClick} disabled={disabled}>
      {icon && <Icon name={icon} size={20} />}
      <span>{children}</span>
    </button>
  );
}

/** Groupe de réglages / actions façon tableau iOS. */
export function Group({ title, footer, children }: { title?: string; footer?: ComponentChildren; children: ComponentChildren }) {
  return (
    <section class="group">
      {title && <h3 class="group-title">{title}</h3>}
      <div class="group-body">{children}</div>
      {footer && <p class="group-footer">{footer}</p>}
    </section>
  );
}

export function Cell({
  icon,
  label,
  detail,
  onClick,
  chevron,
  danger,
  children,
  tint,
}: {
  icon?: IconName;
  label: ComponentChildren;
  detail?: ComponentChildren;
  onClick?: () => void;
  chevron?: boolean;
  danger?: boolean;
  children?: ComponentChildren;
  tint?: string;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag class={`cell ${danger ? 'danger' : ''}`} onClick={onClick}>
      {icon && (
        <span class="cell-icon" style={tint ? { background: tint } : undefined}>
          <Icon name={icon} size={18} />
        </span>
      )}
      <span class="cell-label">{label}</span>
      {detail !== undefined && <span class="cell-detail">{detail}</span>}
      {children}
      {chevron && <Icon name="chevron" size={16} class="cell-chevron" />}
    </Tag>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label class="toggle">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange((e.target as HTMLInputElement).checked)} aria-label={label} />
      <span />
    </label>
  );
}
