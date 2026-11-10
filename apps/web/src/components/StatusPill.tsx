import { PALETTE, type ColorKey } from '@suboard/shared';

export function colorStyle(color: ColorKey | null | undefined): React.CSSProperties | undefined {
  if (!color) return undefined;
  const c = PALETTE[color];
  return c ? { background: c.bg, color: c.fg } : undefined;
}

export function StatusPill({ label, color }: { label: string | null | undefined; color: ColorKey | null | undefined }) {
  if (!label) return <span className="pill empty">—</span>;
  return (
    <span className="pill" style={colorStyle(color)}>
      {label}
    </span>
  );
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function Avatar({ name, small }: { name: string; small?: boolean }) {
  return (
    <span className={small ? 'avatar sm' : 'avatar'} aria-hidden="true" title={name}>
      {initials(name)}
    </span>
  );
}
