import { DateField } from '../DateField';
import { formatDateRangeHe, type StatusOption } from '@suboard/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { colorStyle } from '../StatusPill';

/** Multi-select of label options (tags) as a disclosure popover with native checkboxes. */
export function TagsPicker({ value, options, label, onChange }: { value: string[]; options: StatusOption[]; label: string; onChange: (ids: string[]) => void }) {
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState(value);
  const key = value.join(',');
  useEffect(() => setLocal(value), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const selected = options.filter((o) => local.includes(o.id));

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLInputElement>('.popover input')?.focus();
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const toggle = (id: string) => {
    const next = local.includes(id) ? local.filter((x) => x !== id) : [...local, id];
    setLocal(next);
    onChange(next);
  };

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
    >
      <button ref={triggerRef} type="button" className="person-trigger" aria-expanded={open} aria-controls={popId} onClick={() => setOpen((o) => !o)}>
        <span className="sr-only">{label}: </span>
        {selected.length ? (
          <span className="tag-list">
            {selected.map((o) => (
              <span key={o.id} className="tag" style={colorStyle(o.color)}>
                {o.label}
              </span>
            ))}
          </span>
        ) : (
          <>
            <span className="muted" aria-hidden="true">
              —
            </span>
            <span className="sr-only">ללא</span>
          </>
        )}
      </button>
      {open && (
        <div className="popover" id={popId}>
          <fieldset>
            <legend>{label}</legend>
            {options.filter((o) => !o.inactive || local.includes(o.id)).map((o) => (
              <label key={o.id}>
                <input type="checkbox" checked={local.includes(o.id)} onChange={() => toggle(o.id)} />
                <span className="tag" style={colorStyle(o.color)}>
                  {o.label}
                </span>
              </label>
            ))}
            {options.length === 0 && <p className="muted">אין תגיות. בעלי הלוח מגדירים אותן בהגדרות.</p>}
          </fieldset>
        </div>
      )}
    </div>
  );
}

/** Two native date inputs; commits only a complete, ordered range (or clears when both are empty). */
export function DateRangeEditor({
  value,
  label,
  readOnly,
  onChange,
}: {
  value: { from: string; to: string } | null;
  label: string;
  readOnly: boolean;
  onChange: (v: { from: string; to: string } | null) => void;
}) {
  const [from, setFrom] = useState(value?.from ?? '');
  const [to, setTo] = useState(value?.to ?? '');
  const [error, setError] = useState(false);
  const key = `${value?.from}|${value?.to}`;
  useEffect(() => {
    setFrom(value?.from ?? '');
    setTo(value?.to ?? '');
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  if (readOnly) return <span className="cell-readonly">{formatDateRangeHe(value) || '—'}</span>;
  const commit = (f: string, t: string) => {
    if (!f && !t) return (setError(false), onChange(null));
    if (f && t) {
      if (f > t) return setError(true);
      setError(false);
      if (f !== value?.from || t !== value?.to) onChange({ from: f, to: t });
    }
  };
  return (
    <span className="range-cell" role="group" aria-label={label}>
      <DateField className="cell-input" value={from} aria-label={`${label} — מתאריך`} onChange={(iso) => (setFrom(iso), commit(iso, to))} />
      <span aria-hidden="true">–</span>
      <DateField className="cell-input" value={to} aria-label={`${label} — עד תאריך`} onChange={(iso) => (setTo(iso), commit(from, iso))} />
      {error && (
        <span className="sr-only" role="alert">
          תאריך הסיום לפני תאריך ההתחלה
        </span>
      )}
    </span>
  );
}

/** 0–100 progress: a visual bar plus an accessible number input (commit on blur/Enter). */
export function ProgressEditor({ value, label, readOnly, onChange }: { value: number | null; label: string; readOnly: boolean; onChange: (v: number | null) => void }) {
  const [draft, setDraft] = useState(value === null ? '' : String(value));
  useEffect(() => setDraft(value === null ? '' : String(value)), [value]);
  const pct = Math.max(0, Math.min(100, value ?? 0));
  const bar = (
    <span className="progress-bar" aria-hidden="true">
      <span style={{ inlineSize: `${pct}%` }} />
    </span>
  );
  if (readOnly)
    return (
      <span className="progress-cell">
        {bar}
        <span className="num">{value === null ? '—' : `${value}%`}</span>
      </span>
    );
  const commit = () => {
    if (draft.trim() === '') return value !== null && onChange(null);
    const n = Math.round(Number(draft));
    if (Number.isFinite(n) && n >= 0 && n <= 100 && n !== value) onChange(n);
    else setDraft(value === null ? '' : String(value));
  };
  return (
    <span className="progress-cell">
      {bar}
      <input
        className="cell-input num"
        type="number"
        min={0}
        max={100}
        step={5}
        inputMode="numeric"
        value={draft}
        aria-label={`${label} (באחוזים)`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    </span>
  );
}

/** 1–5 rating as a native radio group (arrow keys work); clicking the current star clears it. */
export function RatingEditor({ value: serverValue, label, readOnly, onChange: commit }: { value: number | null; label: string; readOnly: boolean; onChange: (v: number | null) => void }) {
  const name = useId();
  // Local mirror so the radio reflects a click immediately (the cache update lands a tick later).
  const [value, setValue] = useState(serverValue);
  useEffect(() => setValue(serverValue), [serverValue]);
  const onChange = (v: number | null) => (setValue(v), commit(v));
  if (readOnly)
    return (
      <span className="rating" aria-label={value ? `${label}: ${value} מתוך 5` : `${label}: ללא`}>
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} aria-hidden="true" className={value && n <= value ? 'star on' : 'star'}>
            ★
          </span>
        ))}
      </span>
    );
  return (
    <fieldset className="rating">
      <legend className="sr-only">{label}</legend>
      {[1, 2, 3, 4, 5].map((n) => (
        <label key={n} className={value && n <= value ? 'star on' : 'star'}>
          <input
            type="radio"
            className="sr-only"
            name={name}
            value={n}
            checked={value === n}
            onChange={() => onChange(n)}
            onClick={() => value === n && onChange(null)}
          />
          <span aria-hidden="true">★</span>
          <span className="sr-only">{n} מתוך 5</span>
        </label>
      ))}
    </fieldset>
  );
}

const HREF: Record<'link' | 'email' | 'phone', (v: string) => string> = {
  link: (v) => v,
  email: (v) => `mailto:${v}`,
  phone: (v) => `tel:${v.replace(/[^\d+]/g, '')}`,
};

/** URL / e-mail / phone: an input plus an action link (links open in a new tab without opener). */
export function ContactEditor({
  type,
  value,
  label,
  readOnly,
  onChange,
}: {
  type: 'link' | 'email' | 'phone';
  value: string | null;
  label: string;
  readOnly: boolean;
  onChange: (v: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const safe = value && (type !== 'link' || /^https?:\/\//i.test(value)) ? HREF[type](value) : null;
  const linkText = type === 'link' ? (value ?? '').replace(/^https?:\/\//i, '').slice(0, 40) : (value ?? '');
  const action = safe ? (
    <a href={safe} {...(type === 'link' ? { target: '_blank', rel: 'noopener noreferrer' } : {})} className={readOnly ? undefined : 'cell-action'}>
      {readOnly ? <bdi>{linkText}</bdi> : <span className="sr-only">פתיחת {label}</span>}
      {!readOnly && <span aria-hidden="true">↗</span>}
    </a>
  ) : null;
  if (readOnly) return <span className="cell-readonly">{action ?? '—'}</span>;
  return (
    <span className="contact-cell">
      <input
        className="cell-input"
        dir="ltr"
        type={type === 'link' ? 'url' : type === 'email' ? 'email' : 'tel'}
        value={draft}
        aria-label={label}
        maxLength={type === 'link' ? 2000 : 254}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => draft.trim() !== (value ?? '') && onChange(draft.trim() || null)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(value ?? '');
        }}
      />
      {action}
    </span>
  );
}
