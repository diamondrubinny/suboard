import { BUTTON_ACTIONS, COLOR_KEYS, PALETTE, formatWeekHe, todayIso, weekStartIso, type ButtonAction, type CellValue, type ColorKey, type Column } from '@suboard/shared';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import { useToggleVote } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { DateField } from '../DateField';
import { useFeedback } from '../Feedback';

/** Time of day, always 24-hour "HH:MM" (the native control follows the browser's language). */
export function HourCell({ value, onChange, label, id }: { value: string; onChange: (v: string | null) => void; label: string; id?: string }) {
  const [text, setText] = useState(value);
  const [bad, setBad] = useState(false);
  useEffect(() => {
    setText(value);
    setBad(false);
  }, [value]);
  const commit = () => {
    const t = text.trim();
    if (!t) {
      setBad(false);
      if (value) onChange(null);
      return;
    }
    // "830" / "8:30" / "08.30" → "08:30"
    const m = /^(\d{1,2})[:.]?(\d{2})$/.exec(t);
    const h = m ? Number(m[1]) : NaN;
    const min = m ? Number(m[2]) : NaN;
    if (!m || h > 23 || min > 59) return setBad(true);
    const next = `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
    setBad(false);
    setText(next);
    if (next !== value) onChange(next);
  };
  return (
    <input
      id={id}
      className="cell-input hour-input"
      dir="ltr"
      inputMode="numeric"
      placeholder="hh:mm"
      maxLength={5}
      value={text}
      aria-label={label}
      aria-invalid={bad || undefined}
      title={bad ? 'שעה לא תקינה — לדוגמה 08:30' : 'שעה בשעון 24 שעות'}
      onChange={(e) => (setText(e.target.value), setBad(false))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape' && text !== value) {
          e.stopPropagation();
          setText(value);
          setBad(false);
        }
      }}
    />
  );
}

/** A week: pick any day, the cell keeps and shows the whole Sunday–Saturday week. */
export function WeekCell({ value, onChange, label, id }: { value: string; onChange: (v: string | null) => void; label: string; id?: string }) {
  return (
    <span className="week-cell">
      <DateField id={id} className="cell-input" value={value} aria-label={`${label} — יום כלשהו בשבוע`} onChange={(iso) => onChange(iso ? weekStartIso(iso) : null)} />
      {value && <small className="muted nowrap">{formatWeekHe(value)}</small>}
    </span>
  );
}

export function ColorCell({ value, onChange, label, id }: { value: ColorKey | ''; onChange: (v: ColorKey | null) => void; label: string; id?: string }) {
  return (
    <span className="color-cell">
      <span className="color-swatch" aria-hidden="true" style={{ background: value ? PALETTE[value].bg : 'transparent' }} />
      <select id={id} className="cell-input" value={value} aria-label={label} onChange={(e) => onChange((e.target.value || null) as ColorKey | null)}>
        <option value="">—</option>
        {COLOR_KEYS.map((k) => (
          <option key={k} value={k}>
            {PALETTE[k].label}
          </option>
        ))}
      </select>
    </span>
  );
}

/** Vote: one vote per person; pressing again takes it back. */
export function VoteCell({ boardId, itemId, column, votes, canVote, label, id }: { boardId: string; itemId: string; column: Column; votes: string[]; canVote: boolean; label: string; id?: string }) {
  const { user } = useAuth();
  const toggle = useToggleVote(boardId);
  const { toast } = useFeedback();
  const mine = Boolean(user && votes.includes(user.id));
  const text = `${votes.length} קולות`;
  if (!canVote)
    return (
      <span className="cell-readonly num" id={id}>
        {votes.length || '—'}
      </span>
    );
  return (
    <button
      type="button"
      id={id}
      className={mine ? 'btn btn-sm btn-primary vote-btn' : 'btn btn-sm vote-btn'}
      aria-pressed={mine}
      disabled={toggle.isPending}
      aria-label={`${text} — ${label}: ${mine ? 'ביטול ההצבעה שלי' : 'הצבעה'}`}
      onClick={() => toggle.mutate({ itemId, columnId: column.id }, { onError: (e) => toast(errorMessage(e), 'error') })}
    >
      {text}
    </button>
  );
}

/**
 * Action button: one press does one ordinary edit on the item — set a status, stamp today's date,
 * assign me, tick a checkbox, or move it to a group. History, undo, permissions and automations apply.
 */
export function ButtonCell({
  column,
  columns,
  values,
  disabled,
  onSetValue,
  onMoveGroup,
  label,
  id,
}: {
  column: Column;
  columns: Column[];
  values: Record<string, CellValue>;
  disabled: boolean;
  onSetValue?: (columnId: string, value: CellValue) => void;
  onMoveGroup?: (groupId: string) => void;
  label: string;
  id?: string;
}) {
  const { user } = useAuth();
  const cfg = column.settings.button;
  const action: ButtonAction = cfg?.action ?? 'set_status';
  const target = cfg?.columnId ? columns.find((c) => c.id === cfg.columnId) : undefined;
  const option = target?.settings.options?.find((o) => o.id === cfg?.optionId);
  const ready = cfg && (action === 'move_group' ? Boolean(cfg.groupId) : Boolean(target) && target!.type === BUTTON_ACTIONS[action].columnType && (action !== 'set_status' || Boolean(option)));
  if (!cfg || !ready)
    return (
      <span className="cell-readonly muted" id={id}>
        לא הוגדר
      </span>
    );
  const what =
    action === 'set_status'
      ? `קובע ${target!.title} ל"${option!.label}"`
      : action === 'set_today'
        ? `רושם את התאריך של היום ב-${target!.title}`
        : action === 'assign_me'
          ? `משייך אותך ב-${target!.title}`
          : action === 'check'
            ? `מסמן את ${target!.title}`
            : 'מעביר את הפריט לקבוצה שהוגדרה';
  const press = () => {
    if (action === 'move_group') return onMoveGroup?.(cfg.groupId!);
    if (action === 'set_status') return onSetValue?.(target!.id, option!.id);
    if (action === 'set_today') return onSetValue?.(target!.id, todayIso());
    if (action === 'check') return onSetValue?.(target!.id, true);
    const current = Array.isArray(values[target!.id]) ? (values[target!.id] as string[]) : [];
    if (user) onSetValue?.(target!.id, current.includes(user.id) ? current : [...current, user.id]);
  };
  return (
    <button type="button" id={id} className="btn btn-sm" disabled={disabled || (action === 'move_group' ? !onMoveGroup : !onSetValue)} aria-label={`${cfg.label} — ${label}: ${what}`} title={what} onClick={press}>
      {cfg.label}
    </button>
  );
}
