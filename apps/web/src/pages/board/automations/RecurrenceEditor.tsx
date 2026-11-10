import {
  createRecurrenceSchema,
  findDueColumn,
  formatDateHe,
  LIMITS,
  todayIso,
  upcomingOccurrences,
  weekdayOf,
  type BoardDetail,
  type Recurrence,
  type RecurrenceSchedule,
} from '@suboard/shared';
import { useId, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { useRecurrenceMutations } from '../../../api/hooks';
import { Dialog } from '../../../components/Dialog';
import { useFeedback } from '../../../components/Feedback';
import { PersonPicker } from '../../../components/cells/PersonPicker';

export const WEEKDAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
const FREQ_LABELS: Record<RecurrenceSchedule['frequency'], string> = { daily: 'יומי', weekly: 'שבועי', monthly: 'חודשי', yearly: 'שנתי' };
const UNIT: Record<RecurrenceSchedule['frequency'], string> = { daily: 'ימים', weekly: 'שבועות', monthly: 'חודשים', yearly: 'שנים' };

/** "כל שבועיים, בימים ראשון ורביעי" — a short Hebrew description of a schedule. */
export function scheduleText(s: RecurrenceSchedule): string {
  const n = s.interval ?? 1;
  const every = n === 1 ? { daily: 'כל יום', weekly: 'כל שבוע', monthly: 'כל חודש', yearly: 'כל שנה' }[s.frequency] : `כל ${n} ${UNIT[s.frequency]}`;
  if (s.frequency === 'weekly') return `${every}, ביום ${(s.weekdays ?? []).map((d) => WEEKDAYS[d]).join(', ')}`;
  if (s.frequency === 'monthly') return `${every}, ב-${s.monthDay ?? Number(s.startDate.slice(8, 10))} לחודש`;
  if (s.frequency === 'yearly') return `${every}, ב-${formatDateHe(s.startDate).slice(0, 5)}`;
  return every;
}

export function RecurrenceEditor({ board, rec, open, onClose }: { board: BoardDetail; rec: Recurrence | null; open: boolean; onClose: () => void }) {
  const { create, update } = useRecurrenceMutations(board.id);
  const { toast } = useFeedback();
  const today = todayIso();
  const due = findDueColumn(board.columns) ?? board.columns.find((c) => c.type === 'date');
  const personCol = board.columns.find((c) => c.type === 'person');
  const members = board.members.map((m) => ({ id: m.userId, name: m.name }));
  const [name, setName] = useState(rec?.name ?? '');
  const [groupId, setGroupId] = useState(rec?.groupId ?? board.groups[0]?.id ?? '');
  const [schedule, setSchedule] = useState<RecurrenceSchedule>(
    rec?.schedule ?? { frequency: 'monthly', interval: 1, monthDay: Number(today.slice(8, 10)), weekdays: [weekdayOf(today)], startDate: today, endDate: null },
  );
  const [dueColumnId, setDueColumnId] = useState<string>(rec ? (rec.dueColumnId ?? '') : (due?.id ?? ''));
  const [dueOffset, setDueOffset] = useState(rec?.dueOffsetDays ?? 7);
  const [assignees, setAssignees] = useState<string[]>(personCol && Array.isArray(rec?.values[personCol.id]) ? (rec!.values[personCol.id] as string[]) : []);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), group: useId(), freq: useId(), interval: useId(), month: useId(), start: useId(), end: useId(), due: useId(), offset: useId(), preview: useId() };
  const pending = create.isPending || update.isPending;
  const set = (patch: Partial<RecurrenceSchedule>) => setSchedule((s) => ({ ...s, ...patch }));
  const clean: RecurrenceSchedule = {
    frequency: schedule.frequency,
    interval: schedule.interval,
    startDate: schedule.startDate,
    endDate: schedule.endDate || null,
    ...(schedule.frequency === 'weekly' ? { weekdays: schedule.weekdays } : {}),
    ...(schedule.frequency === 'monthly' ? { monthDay: schedule.monthDay } : {}),
  };
  const preview = (() => {
    try {
      return upcomingOccurrences(clean, today, 5);
    } catch {
      return [];
    }
  })();

  const save = () => {
    setError(null);
    const values = { ...(rec?.values ?? {}) } as Record<string, unknown>;
    if (personCol) {
      if (assignees.length) values[personCol.id] = assignees;
      else delete values[personCol.id];
    }
    const parsed = createRecurrenceSchema.safeParse({
      name,
      groupId,
      values,
      schedule: clean,
      dueColumnId: dueColumnId || null,
      dueOffsetDays: dueOffset,
      enabled: rec?.enabled ?? true,
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.path[0] === 'name' ? 'יש לתת שם לפריט' : (issue?.message ?? 'יש להשלים את השדות'));
      return;
    }
    const done = () => {
      toast(rec ? 'הפריט החוזר עודכן' : 'הפריט החוזר נשמר');
      onClose();
    };
    if (rec) update.mutate({ id: rec.id, patch: parsed.data }, { onSuccess: done, onError: (e) => setError(errorMessage(e)) });
    else create.mutate(parsed.data, { onSuccess: done, onError: (e) => setError(errorMessage(e)) });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={rec ? `עריכת פריט חוזר: ${rec.name}` : 'פריט חוזר חדש'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
            {pending ? 'שומר…' : 'שמירה'}
          </button>
        </>
      }
    >
      <div className="rule-editor">
        <div className="field">
          <label htmlFor={ids.name}>שם הפריט שייווצר</label>
          <input id={ids.name} className="input" maxLength={LIMITS.itemName} value={name} placeholder="לדוגמה: בדיקת מטפים — בניין 3" onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="rule-row">
          <div className="field">
            <label htmlFor={ids.group}>בקבוצה</label>
            <select id={ids.group} className="select" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {board.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          {personCol && (
            <div className="field">
              <span className="label">{personCol.title}</span>
              <PersonPicker label={personCol.title} users={members} candidates={members} value={assignees} onChange={setAssignees} />
            </div>
          )}
        </div>

        <fieldset className="rule-block">
          <legend>
            <span className="rule-kw">מתי</span>
          </legend>
          <div className="rule-row">
            <div className="field">
              <label htmlFor={ids.freq}>תדירות</label>
              <select id={ids.freq} className="select" value={schedule.frequency} onChange={(e) => set({ frequency: e.target.value as RecurrenceSchedule['frequency'] })}>
                {(Object.keys(FREQ_LABELS) as RecurrenceSchedule['frequency'][]).map((f) => (
                  <option key={f} value={f}>
                    {FREQ_LABELS[f]}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={ids.interval}>כל כמה {UNIT[schedule.frequency]}</label>
              <input
                id={ids.interval}
                type="number"
                inputMode="numeric"
                className="input"
                min={1}
                max={36}
                value={schedule.interval ?? 1}
                onChange={(e) => set({ interval: Math.max(1, Math.min(36, Math.trunc(Number(e.target.value) || 1))) })}
              />
            </div>
            {schedule.frequency === 'monthly' && (
              <div className="field">
                <label htmlFor={ids.month}>יום בחודש</label>
                <input
                  id={ids.month}
                  type="number"
                  inputMode="numeric"
                  className="input"
                  min={1}
                  max={31}
                  aria-describedby={`${ids.month}-hint`}
                  value={schedule.monthDay ?? 1}
                  onChange={(e) => set({ monthDay: Math.max(1, Math.min(31, Math.trunc(Number(e.target.value) || 1))) })}
                />
                <span id={`${ids.month}-hint`} className="hint">
                  29–31: בחודש קצר יותר — היום האחרון בחודש.
                </span>
              </div>
            )}
          </div>
          {schedule.frequency === 'weekly' && (
            <fieldset className="check-list check-list-row">
              <legend className="label">ימים בשבוע</legend>
              {WEEKDAYS.map((d, i) => (
                <label key={d} className="check">
                  <input
                    type="checkbox"
                    checked={schedule.weekdays?.includes(i) ?? false}
                    onChange={(e) => set({ weekdays: e.target.checked ? [...(schedule.weekdays ?? []), i].sort() : (schedule.weekdays ?? []).filter((x) => x !== i) })}
                  />{' '}
                  {d}
                </label>
              ))}
            </fieldset>
          )}
          <div className="rule-row">
            <div className="field">
              <label htmlFor={ids.start}>{schedule.frequency === 'yearly' ? 'תאריך (חוזר כל שנה)' : 'החל מתאריך'}</label>
              <input id={ids.start} type="date" className="input" value={schedule.startDate} onChange={(e) => e.target.value && set({ startDate: e.target.value })} />
            </div>
            <div className="field">
              <label htmlFor={ids.end}>עד תאריך (לא חובה)</label>
              <input id={ids.end} type="date" className="input" value={schedule.endDate ?? ''} onChange={(e) => set({ endDate: e.target.value || null })} />
            </div>
          </div>
        </fieldset>

        <div className="rule-row">
          <div className="field">
            <label htmlFor={ids.due}>עמודת יעד</label>
            <select id={ids.due} className="select" value={dueColumnId} onChange={(e) => setDueColumnId(e.target.value)}>
              <option value="">ללא</option>
              {board.columns
                .filter((c) => c.type === 'date')
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
            </select>
          </div>
          {dueColumnId && (
            <div className="field">
              <label htmlFor={ids.offset}>יעד = מועד היצירה + ימים</label>
              <input
                id={ids.offset}
                type="number"
                inputMode="numeric"
                className="input"
                min={0}
                max={365}
                value={dueOffset}
                onChange={(e) => setDueOffset(Math.max(0, Math.min(365, Math.trunc(Number(e.target.value) || 0))))}
              />
            </div>
          )}
        </div>

        <div className="rule-preview" id={ids.preview}>
          <span className="label">{scheduleText(clean)} — המועדים הבאים</span>
          {preview.length ? (
            <ul className="date-chips">
              {preview.map((d) => (
                <li key={d}>
                  {WEEKDAYS[weekdayOf(d)]} {formatDateHe(d)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">אין מועדים עתידיים (בדקו את תאריך הסיום).</p>
          )}
        </div>
        <p className="hint">הפריט נוצר בתחילת יום המועד. אם המערכת הייתה כבויה וכמה מועדים עברו — נוצר פריט אחד בלבד.</p>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
