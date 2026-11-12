import {
  COLOR_KEYS,
  PALETTE,
  FILTER_OP_LABELS,
  MAX_FILTER_RULES,
  filterOpNeedsValue,
  filterOpsFor,
  type BoardDetail,
  type BoardFilter,
  type Column,
  type DirectoryUser,
  type FilterOp,
  type FilterRule,
} from '@suboard/shared';
import { useState } from 'react';
import { DateField } from '../../components/DateField';
import { Dialog } from '../../components/Dialog';
import { Icon } from '../../components/Icon';

const NAME = { id: 'name', title: 'שם הפריט', type: 'name' as const };
type Target = Column | typeof NAME;

const targetsOf = (board: BoardDetail): Target[] => [NAME, ...board.columns.filter((c) => filterOpsFor(c.type).length > 0)];
const defaultRule = (t: Target): FilterRule => ({ columnId: t.id, op: filterOpsFor(t.type)[0]! });

/** How many rules of a filter are complete enough to hide something. */
export const activeRuleCount = (f: BoardFilter | undefined): number => f?.rules.length ?? 0;

/**
 * Advanced filter: "show items where all / any of these hold". Each rule picks a column, an
 * operator that fits its type, and a value. Applied as it is edited; saved with the view.
 */
export function FilterBuilder({ board, users, value, onChange }: { board: BoardDetail; users: DirectoryUser[]; value: BoardFilter | undefined; onChange: (f: BoardFilter | undefined) => void }) {
  const [open, setOpen] = useState(false);
  const targets = targetsOf(board);
  const filter: BoardFilter = value ?? { match: 'all', rules: [] };
  const n = activeRuleCount(value);
  const commit = (next: BoardFilter) => onChange(next.rules.length ? next : undefined);
  const setRule = (i: number, patch: Partial<FilterRule>) => commit({ ...filter, rules: filter.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)) });

  return (
    <>
      <button type="button" className={n ? 'btn btn-sm btn-primary' : 'btn btn-sm'} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <Icon name="search" size={16} /> סינון מתקדם{n > 0 && <span> ({n})</span>}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="סינון מתקדם"
        footer={
          <>
            <button type="button" className="btn" disabled={!filter.rules.length} onClick={() => onChange(undefined)}>
              ניקוי הכול
            </button>
            <button type="button" className="btn btn-primary" onClick={() => setOpen(false)}>
              סיום
            </button>
          </>
        }
      >
        <p className="muted">הסינון חל מיד על הלוח, ונשמר יחד עם התצוגה ב"שמירה כתצוגה".</p>
        {filter.rules.length > 1 && (
          <fieldset className="filter-match">
            <legend>להציג פריטים ש…</legend>
            <label className="check">
              <input type="radio" name="filter-match" checked={filter.match === 'all'} onChange={() => commit({ ...filter, match: 'all' })} /> עומדים בכל התנאים
            </label>
            <label className="check">
              <input type="radio" name="filter-match" checked={filter.match === 'any'} onChange={() => commit({ ...filter, match: 'any' })} /> עומדים באחד התנאים לפחות
            </label>
          </fieldset>
        )}
        <ol className="list-plain filter-rules">
          {filter.rules.map((r, i) => {
            const t = targets.find((x) => x.id === r.columnId);
            const ops = t ? filterOpsFor(t.type) : [];
            return (
              <li key={i}>
                <div className="filter-rule" role="group" aria-label={`תנאי ${i + 1}`}>
                <label className="sr-only" htmlFor={`fr-c-${i}`}>
                  עמודה בתנאי {i + 1}
                </label>
                <select
                  id={`fr-c-${i}`}
                  className="select"
                  value={t ? r.columnId : ''}
                  onChange={(e) => {
                    const nt = targets.find((x) => x.id === e.target.value);
                    if (nt) setRule(i, { ...defaultRule(nt), value: undefined });
                  }}
                >
                  {!t && <option value="">(עמודה שנמחקה)</option>}
                  {targets.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.title}
                    </option>
                  ))}
                </select>
                <label className="sr-only" htmlFor={`fr-o-${i}`}>
                  סוג התנאי {i + 1}
                </label>
                <select id={`fr-o-${i}`} className="select" value={r.op} disabled={!t} onChange={(e) => setRule(i, { op: e.target.value as FilterOp, value: undefined })}>
                  {ops.map((o) => (
                    <option key={o} value={o}>
                      {FILTER_OP_LABELS[o]}
                    </option>
                  ))}
                </select>
                {t && filterOpNeedsValue(r.op) && <RuleValue index={i} target={t} rule={r} users={users} board={board} onChange={(v) => setRule(i, { value: v })} />}
                <button type="button" className="icon-btn" aria-label={`הסרת תנאי ${i + 1}`} onClick={() => commit({ ...filter, rules: filter.rules.filter((_, j) => j !== i) })}>
                  <Icon name="trash" size={16} />
                </button>
                </div>
              </li>
            );
          })}
        </ol>
        {filter.rules.length === 0 && <p className="hint">אין תנאים. הוסיפו תנאי כדי להציג רק חלק מהפריטים — למשל "תאריך יעד עבר" או "אחראי הוא אחד מ-…".</p>}
        <button type="button" className="btn btn-sm" disabled={filter.rules.length >= MAX_FILTER_RULES} onClick={() => commit({ ...filter, rules: [...filter.rules, defaultRule(targets[0]!)] })}>
          <Icon name="plus" size={16} /> הוספת תנאי
        </button>
      </Dialog>
    </>
  );
}

function RuleValue({ index, target, rule, users, board, onChange }: { index: number; target: Target; rule: FilterRule; users: DirectoryUser[]; board: BoardDetail; onChange: (v: FilterRule['value']) => void }) {
  const label = `ערך לתנאי ${index + 1}`;
  if (rule.op === 'any_of' || rule.op === 'none_of') {
    const column = target as Column;
    const memberIds = new Set(board.members.map((m) => m.userId));
    const choices =
      column.type === 'person'
        ? users.filter((u) => memberIds.has(u.id)).map((u) => ({ id: u.id, label: u.name }))
        : column.type === 'color'
          ? COLOR_KEYS.map((k) => ({ id: k as string, label: PALETTE[k].label }))
          : (column.settings.options ?? []).map((o) => ({ id: o.id, label: o.label }));
    const picked = Array.isArray(rule.value) ? rule.value : [];
    return (
      <fieldset className="filter-choices">
        <legend className="sr-only">{label}</legend>
        {choices.map((c) => (
          <label key={c.id} className="check">
            <input type="checkbox" checked={picked.includes(c.id)} onChange={(e) => onChange(e.target.checked ? [...picked, c.id] : picked.filter((x) => x !== c.id))} /> {c.label}
          </label>
        ))}
        {choices.length === 0 && <span className="muted">אין ערכים לבחירה</span>}
      </fieldset>
    );
  }
  if (rule.op === 'before' || rule.op === 'after' || rule.op === 'on') {
    return <DateField aria-label={label} value={typeof rule.value === 'string' ? rule.value : ''} onChange={(iso) => onChange(iso || undefined)} />;
  }
  if (target.type === 'hour') {
    return <input className="input filter-number" dir="ltr" inputMode="numeric" placeholder="hh:mm" maxLength={5} aria-label={`שעה לתנאי ${index + 1}`} value={typeof rule.value === 'string' ? rule.value : ''} onChange={(e) => onChange(e.target.value || undefined)} />;
  }
  if (rule.op === 'next_days' || rule.op === 'last_days' || rule.op === 'eq' || rule.op === 'gt' || rule.op === 'lt') {
    const days = rule.op === 'next_days' || rule.op === 'last_days';
    return (
      <input
        type="number"
        className="input filter-number"
        aria-label={days ? `מספר ימים לתנאי ${index + 1}` : target.type === 'time' ? `מספר שעות לתנאי ${index + 1}` : label}
        placeholder={days ? 'ימים' : target.type === 'time' ? 'שעות' : undefined}
        step="any"
        min={days ? 0 : undefined}
        value={typeof rule.value === 'number' ? rule.value : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
    );
  }
  return <input className="input" aria-label={label} maxLength={200} value={typeof rule.value === 'string' ? rule.value : ''} onChange={(e) => onChange(e.target.value || undefined)} />;
}
