import { formatDateHe, type CellValue, type Column, type DirectoryUser } from '@suboard/shared';
import { useEffect, useId, useState } from 'react';
import { colorStyle, StatusPill } from '../StatusPill';
import { PersonPicker, personNames } from './PersonPicker';

export interface CellEditorProps {
  column: Column;
  value: CellValue | undefined;
  onChange: (value: CellValue) => void;
  readOnly: boolean;
  users: DirectoryUser[];
  /** People that may be assigned (board members). Defaults to `users`. */
  assignable?: DirectoryUser[];
  /** Accessible name, e.g. "סטטוס — <item name>". */
  label: string;
  overdue?: boolean;
  /** Table mode shows long text as a button that opens the item; drawer mode edits inline. */
  mode?: 'table' | 'drawer';
  onOpenItem?: () => void;
  id?: string;
}

/** Text-like input that commits on blur / Enter and reverts on Escape. */
function CommitInput({
  type,
  value,
  onCommit,
  label,
  className,
  id,
}: {
  type: 'text' | 'number';
  value: string;
  onCommit: (v: string) => void;
  label: string;
  className?: string;
  id?: string;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft !== value) onCommit(draft);
  };
  return (
    <input
      id={id}
      className={className ?? 'cell-input'}
      type={type}
      inputMode={type === 'number' ? 'decimal' : undefined}
      step={type === 'number' ? 'any' : undefined}
      value={draft}
      aria-label={label}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') {
          setDraft(value);
          e.stopPropagation();
        }
      }}
    />
  );
}

function LongTextEditor({ value, onCommit, label, id }: { value: string; onCommit: (v: string) => void; label: string; id?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      id={id}
      className="textarea"
      value={draft}
      aria-label={label}
      maxLength={5000}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
    />
  );
}

export function CellEditor(props: CellEditorProps) {
  const { column, value, onChange, readOnly, users, assignable, label, overdue, mode = 'table', onOpenItem, id } = props;
  const options = column.settings.options ?? [];
  const autoId = useId();
  const inputId = id ?? autoId;

  switch (column.type) {
    case 'status': {
      const current = typeof value === 'string' ? options.find((o) => o.id === value) : undefined;
      if (readOnly) return <StatusPill label={current?.label} color={current?.color} />;
      return (
        <select
          id={inputId}
          className={current ? 'pill-select' : 'pill-select empty'}
          style={colorStyle(current?.color)}
          value={current?.id ?? ''}
          aria-label={label}
          onChange={(e) => onChange(e.target.value || null)}
        >
          <option value="">—</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      );
    }

    case 'person': {
      const ids = Array.isArray(value) ? value : [];
      if (readOnly) return <span className="cell-readonly person-names">{personNames(ids, users) || '—'}</span>;
      return <PersonPicker value={ids} users={users} candidates={assignable ?? users} label={label} onChange={(next) => onChange(next.length ? next : null)} />;
    }

    case 'date': {
      const v = typeof value === 'string' ? value : '';
      if (readOnly)
        return (
          <span className={overdue ? 'cell-readonly cell-input overdue' : 'cell-readonly'}>
            {formatDateHe(v) || '—'}
            {overdue && <span className="sr-only"> (באיחור)</span>}
          </span>
        );
      return (
        <span style={{ display: 'block' }}>
          <input
            id={inputId}
            type="date"
            className={overdue ? 'cell-input overdue' : 'cell-input'}
            value={v}
            aria-label={overdue ? `${label} (באיחור)` : label}
            onChange={(e) => onChange(e.target.value || null)}
          />
        </span>
      );
    }

    case 'checkbox': {
      const checked = value === true;
      return (
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={readOnly}
          aria-label={label}
          style={{ inlineSize: '1.15rem', blockSize: '1.15rem' }}
          onChange={(e) => onChange(e.target.checked)}
        />
      );
    }

    case 'number': {
      const v = typeof value === 'number' ? String(value) : '';
      if (readOnly) return <span className="cell-readonly">{v || '—'}</span>;
      return (
        <CommitInput
          id={inputId}
          type="number"
          value={v}
          label={label}
          onCommit={(s) => {
            if (s.trim() === '') return onChange(null);
            const n = Number(s);
            if (Number.isFinite(n)) onChange(n);
          }}
        />
      );
    }

    case 'long_text': {
      const v = typeof value === 'string' ? value : '';
      if (mode === 'drawer') {
        if (readOnly) return <p className="update body">{v || '—'}</p>;
        return <LongTextEditor id={inputId} value={v} label={label} onCommit={(s) => onChange(s.trim() ? s : null)} />;
      }
      return (
        <button type="button" className="long-text-btn" onClick={onOpenItem} aria-label={`${label}: ${v ? v.slice(0, 80) : 'ריק'} — פתיחה לעריכה`}>
          {v || <span className="muted">—</span>}
        </button>
      );
    }

    case 'text':
    default: {
      const v = typeof value === 'string' ? value : '';
      if (readOnly) return <span className="cell-readonly">{v || '—'}</span>;
      return <CommitInput id={inputId} type="text" value={v} label={label} onCommit={(s) => onChange(s.trim() ? s.trim() : null)} />;
    }
  }
}
