import { DateField } from '../DateField';
import { RelationCell } from './RelationCell';
import { evaluateFormula, formatFormulaValue, todayIso, checklistStats, isDateRange, formatAutoId, formatDateHe, formatDateTimeHe, type CellValue, type Column, type DirectoryUser, type LinkStat, type RelatedItem } from '@suboard/shared';
import { useEffect, useId, useState } from 'react';
import { colorStyle, StatusPill } from '../StatusPill';
import { ContactEditor, DateRangeEditor, ProgressEditor, RatingEditor, TagsPicker } from './ExtraCells';
import { PersonPicker, personNames } from './PersonPicker';
import { ChecklistEditor, ChecklistSummary, RiskEditor } from './FieldCells';

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
  /** The item's running number (for `auto_id` columns). */
  seq?: number;
  /** Creator (`created_by` columns): user id, or null for items created by an automation. */
  createdBy?: string | null;
  /** Last update time (`updated_at` columns). */
  updatedAt?: string;
  /** For `formula` columns: the board's columns and the item's cells the formula reads. */
  columns?: Column[];
  values?: Record<string, CellValue>;
  /** For `linked` columns: linked items the viewer may see, and how many are done. */
  linkStat?: LinkStat;
  /** For `relation` columns: the item, its board and the connected items; for `mirror`: the mirrored texts. */
  itemId?: string;
  boardId?: string;
  related?: RelatedItem[];
  mirrored?: string[];
  /** For `files` columns: how many files the item has. */
  fileCount?: number;
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

function checklistLabel(label: string, column: Column, value: unknown): string {
  const st = checklistStats(column, value);
  const done = st.total - st.open;
  // Starts with the visible text ("5/8 1 לא תקין" / "הושלם") so speech input users can say what they see.
  const visible = `${done}/${st.total}${st.fail ? ` ${st.fail} לא תקין` : ''}${st.open === 0 && st.fail === 0 && st.total > 0 ? ' הושלם' : ''}`;
  return `${visible} — ${label}: ${done} מתוך ${st.total} נבדקו — פתיחה לעריכה`;
}

export function CellEditor(props: CellEditorProps) {
  const { column, value, onChange, readOnly, users, assignable, label, overdue, mode = 'table', onOpenItem, id, seq, createdBy, updatedAt, columns, values, linkStat, itemId, boardId, related, mirrored, fileCount } = props;
  const options = column.settings.options ?? [];
  const autoId = useId();
  const inputId = id ?? autoId;

  switch (column.type) {
    case 'auto_id':
      return (
        <span className="cell-readonly auto-id num" id={inputId}>
          {seq ? formatAutoId(seq, column.settings.prefix) : '—'}
        </span>
      );

    case 'files': {
      const n = fileCount ?? 0;
      const text = n === 0 ? 'אין קבצים' : n === 1 ? 'קובץ אחד' : `${n} קבצים`;
      return mode === 'table' && onOpenItem ? (
        <button type="button" className="long-text-btn" id={inputId} onClick={onOpenItem} aria-label={`${text} — ${label}: פתיחת הפריט`}>
          {n === 0 ? '—' : text}
        </button>
      ) : (
        <span className="cell-readonly" id={inputId}>
          {text} <span className="muted">(בלשונית "קבצים")</span>
        </span>
      );
    }

    case 'relation':
      if (!itemId || !boardId) return <span className="cell-readonly" id={inputId}>—</span>;
      return <RelationCell column={column} boardId={boardId} itemId={itemId} related={related ?? []} readOnly={readOnly} label={label} mode={mode} id={inputId} />;

    case 'mirror':
      return (
        <span className="cell-readonly" id={inputId} title={mirrored?.join(', ') || undefined}>
          {mirrored?.length ? mirrored.join(', ') : <span aria-label="אין ערך">—</span>}
        </span>
      );

    case 'linked': {
      if (!linkStat?.total) return <span className="cell-readonly" id={inputId}><span aria-label="אין פריטים מקושרים">—</span></span>;
      const text = `${linkStat.done}/${linkStat.total} בוצעו`;
      const body = (
        <>
          <span className="progress-bar" aria-hidden="true">
            <span style={{ inlineSize: `${Math.round((linkStat.done / linkStat.total) * 100)}%` }} />
          </span>
          <span className="nowrap">{text}</span>
        </>
      );
      return mode === 'table' && onOpenItem ? (
        <button type="button" className="long-text-btn progress-cell" id={inputId} onClick={onOpenItem} aria-label={`${text} — ${label}: פתיחת הפריט`}>
          {body}
        </button>
      ) : (
        <span className="cell-readonly progress-cell" id={inputId}>
          {body}
        </span>
      );
    }

    case 'formula': {
      const result = columns && values ? evaluateFormula(column, { values, seq: seq ?? 0 }, columns, todayIso()) : null;
      return (
        <span className={`cell-readonly formula-cell${typeof result === 'number' ? ' num' : ''}`} id={inputId}>
          {result === null || result === '' ? <span aria-label="אין תוצאה">—</span> : formatFormulaValue(result)}
        </span>
      );
    }

    case 'created_by':
      return (
        <span className="cell-readonly" id={inputId}>
          {createdBy === undefined ? '—' : createdBy === null ? 'אוטומציה' : (users.find((u) => u.id === createdBy)?.name ?? 'משתמש שאינו פעיל')}
        </span>
      );

    case 'updated_at':
      return (
        <span className="cell-readonly num" id={inputId}>
          {updatedAt ? <time dateTime={updatedAt}>{formatDateTimeHe(updatedAt)}</time> : '—'}
        </span>
      );

    case 'risk':
      return <RiskEditor value={value} label={label} readOnly={readOnly} onChange={onChange} />;

    case 'checklist':
      if (mode === 'drawer') return <ChecklistEditor column={column} value={value} label={label} readOnly={readOnly} onChange={onChange} />;
      return (
        <button type="button" className="long-text-btn" onClick={onOpenItem} aria-label={checklistLabel(label, column, value)}>
          <ChecklistSummary column={column} value={value} />
        </button>
      );

    case 'tags': {
      const ids = Array.isArray(value) ? (value as string[]) : [];
      if (readOnly) {
        const sel = options.filter((o) => ids.includes(o.id));
        return (
          <span className="tag-list">
            {sel.length ? sel.map((o) => <StatusPill key={o.id} label={o.label} color={o.color} />) : '—'}
          </span>
        );
      }
      return <TagsPicker value={ids} options={options} label={label} onChange={(next) => onChange(next.length ? next : null)} />;
    }

    case 'date_range': {
      const v = isDateRange(value) ? value : null;
      return <DateRangeEditor value={v} label={label} readOnly={readOnly} onChange={onChange} />;
    }

    case 'progress':
      return <ProgressEditor value={typeof value === 'number' ? value : null} label={label} readOnly={readOnly} onChange={onChange} />;

    case 'rating':
      return <RatingEditor value={typeof value === 'number' ? value : null} label={label} readOnly={readOnly} onChange={onChange} />;

    case 'link':
    case 'email':
    case 'phone':
      return <ContactEditor type={column.type} value={typeof value === 'string' ? value : null} label={label} readOnly={readOnly} onChange={onChange} />;

    case 'status': {
      const current = typeof value === 'string' ? options.find((o) => o.id === value) : undefined;
      if (readOnly) return <StatusPill label={current?.label} color={current?.color} />;
      return <StatusSelect id={inputId} options={options} value={current?.id ?? ''} label={label} onChange={(v) => onChange(v || null)} />;
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
          <DateField id={inputId} className={overdue ? 'cell-input overdue' : 'cell-input'} value={v} aria-label={overdue ? `${label} (באיחור)` : label} onChange={(iso) => onChange(iso || null)} />
        </span>
      );
    }

    case 'checkbox':
      return <CheckboxCell id={inputId} value={value === true} readOnly={readOnly} label={label} onChange={onChange} />;

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

/** Mirrors a server value locally so a controlled field reflects the user's change immediately. */
function useLocal<T>(server: T): [T, (v: T) => void] {
  const [v, setV] = useState(server);
  useEffect(() => setV(server), [server]);
  return [v, setV];
}

function StatusSelect({ id, options, value, label, onChange }: { id: string; options: NonNullable<Column['settings']['options']>; value: string; label: string; onChange: (v: string) => void }) {
  const [local, setLocal] = useLocal(value);
  const current = options.find((o) => o.id === local);
  return (
    <select
      id={id}
      className={current ? 'pill-select' : 'pill-select empty'}
      style={colorStyle(current?.color)}
      value={local}
      aria-label={label}
      onChange={(e) => (setLocal(e.target.value), onChange(e.target.value))}
    >
      <option value="">—</option>
      {options
        .filter((o) => !o.inactive || o.id === local)
        .map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
            {o.inactive ? ' (לא בשימוש)' : ''}
          </option>
        ))}
    </select>
  );
}

function CheckboxCell({ id, value, readOnly, label, onChange }: { id: string; value: boolean; readOnly: boolean; label: string; onChange: (v: boolean) => void }) {
  const [local, setLocal] = useLocal(value);
  return (
    <input
      id={id}
      type="checkbox"
      checked={local}
      disabled={readOnly}
      aria-label={label}
      style={{ inlineSize: '1.15rem', blockSize: '1.15rem' }}
      onChange={(e) => (setLocal(e.target.checked), onChange(e.target.checked))}
    />
  );
}
