import type { DirectoryUser } from '@suboard/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Avatar } from '../StatusPill';

export function personNames(ids: string[], users: DirectoryUser[]): string {
  return ids
    .map((id) => users.find((u) => u.id === id)?.name ?? 'משתמש לא פעיל')
    .join(', ');
}

/**
 * Multi-select of people as a disclosure popover with native checkboxes
 * (keyboard: Enter/Space opens, Tab moves between checkboxes, Escape closes).
 */
export function PersonPicker({
  value,
  users,
  candidates,
  label,
  onChange,
}: {
  value: string[];
  /** Directory used to display names of current values. */
  users: DirectoryUser[];
  /** Users offered for selection (board members); current values are always listed too. */
  candidates?: DirectoryUser[];
  label: string;
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popId = useId();
  // Local mirror for instant feedback; re-synced whenever the server value changes.
  const [local, setLocal] = useState(value);
  const valueKey = value.join(',');
  useEffect(() => setLocal(value), [valueKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const names = personNames(local, users);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLInputElement>('.popover input')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = (id: string) => {
    const next = local.includes(id) ? local.filter((v) => v !== id) : [...local, id];
    setLocal(next);
    onChange(next);
  };
  const pool = candidates ?? users;
  // Keep currently-assigned people visible (so they can be unassigned) even if no longer members.
  const options = [...pool, ...users.filter((u) => local.includes(u.id) && !pool.some((p) => p.id === u.id))];
  const visible = options.filter((u) => u.name.includes(filter.trim()));

  return (
    <div
      className="person-cell"
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
      onBlur={(e) => {
        if (open && !rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false);
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="person-trigger"
        aria-expanded={open}
        aria-controls={popId}
        onClick={() => setOpen((o) => !o)}
      >
        {/* Accessible name = label + the visible names (WCAG 2.5.3 Label in Name). */}
        <span className="sr-only">{label}: </span>
        {local.slice(0, 3).map((id) => (
          <Avatar key={id} small name={users.find((u) => u.id === id)?.name ?? '?'} />
        ))}
        <span className="person-names">
          {names || (
            <>
              <span className="muted" aria-hidden="true">
                —
              </span>
              <span className="sr-only">לא הוקצה</span>
            </>
          )}
        </span>
      </button>
      {open && (
        <div className="popover" id={popId}>
          <fieldset>
            <legend>{label}</legend>
            {options.length > 8 && (
              <input
                className="input"
                style={{ marginBottom: '0.4rem' }}
                type="search"
                placeholder="חיפוש…"
                aria-label="חיפוש אנשים"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
            )}
            {visible.map((u) => (
              <label key={u.id}>
                <input type="checkbox" checked={local.includes(u.id)} onChange={() => toggle(u.id)} />
                <Avatar small name={u.name} />
                {u.name}
              </label>
            ))}
            {visible.length === 0 && <p className="muted">לא נמצאו משתמשים</p>}
          </fieldset>
        </div>
      )}
    </div>
  );
}
