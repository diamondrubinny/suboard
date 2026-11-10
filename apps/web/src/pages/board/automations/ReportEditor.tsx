import { createReportSchema, type BoardDetail, type ReportFrequency, type ScheduledReport } from '@suboard/shared';
import { useId, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { useReportMutations } from '../../../api/hooks';
import { Dialog } from '../../../components/Dialog';
import { useFeedback } from '../../../components/Feedback';
import { WEEKDAYS } from './RecurrenceEditor';

export const FREQ_TEXT: Record<ReportFrequency, string> = { daily: 'יומי', weekly: 'שבועי', monthly: 'חודשי' };

export function reportWhen(r: Pick<ScheduledReport, 'frequency' | 'weekday' | 'monthDay'>): string {
  if (r.frequency === 'weekly') return `כל יום ${WEEKDAYS[r.weekday]}`;
  if (r.frequency === 'monthly') return `ב-${r.monthDay} בכל חודש`;
  return 'כל יום';
}

export function ReportEditor({ board, report, open, onClose }: { board: BoardDetail; report: ScheduledReport | null; open: boolean; onClose: () => void }) {
  const { create, update } = useReportMutations(board.id);
  const { toast } = useFeedback();
  const [name, setName] = useState(report?.name ?? 'סיכום שבועי');
  const [frequency, setFrequency] = useState<ReportFrequency>(report?.frequency ?? 'weekly');
  const [weekday, setWeekday] = useState(report?.weekday ?? 0);
  const [monthDay, setMonthDay] = useState(report?.monthDay ?? 1);
  const [recipients, setRecipients] = useState<string[]>(report?.recipients ?? []);
  const [error, setError] = useState<string | null>(null);
  const ids = { name: useId(), freq: useId(), wd: useId(), md: useId() };
  const pending = create.isPending || update.isPending;

  const save = () => {
    setError(null);
    const parsed = createReportSchema.safeParse({ name, frequency, weekday, monthDay, recipients, enabled: report?.enabled ?? true });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.path[0] === 'name' ? 'יש לתת שם לדוח' : (issue?.message ?? 'יש להשלים את השדות'));
      return;
    }
    const done = () => {
      toast(report ? 'הדוח עודכן' : 'הדוח המתוזמן נשמר');
      onClose();
    };
    if (report) update.mutate({ id: report.id, patch: parsed.data }, { onSuccess: done, onError: (e) => setError(errorMessage(e)) });
    else create.mutate(parsed.data, { onSuccess: done, onError: (e) => setError(errorMessage(e)) });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={report ? `עריכת דוח: ${report.name}` : 'דוח מתוזמן חדש'}
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
          <label htmlFor={ids.name}>שם הדוח</label>
          <input id={ids.name} className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="rule-row">
          <div className="field">
            <label htmlFor={ids.freq}>תדירות</label>
            <select id={ids.freq} className="select" value={frequency} onChange={(e) => setFrequency(e.target.value as ReportFrequency)}>
              {(Object.keys(FREQ_TEXT) as ReportFrequency[]).map((f) => (
                <option key={f} value={f}>
                  {FREQ_TEXT[f]}
                </option>
              ))}
            </select>
          </div>
          {frequency === 'weekly' && (
            <div className="field">
              <label htmlFor={ids.wd}>ביום</label>
              <select id={ids.wd} className="select" value={weekday} onChange={(e) => setWeekday(Number(e.target.value))}>
                {WEEKDAYS.map((d, i) => (
                  <option key={d} value={i}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          )}
          {frequency === 'monthly' && (
            <div className="field">
              <label htmlFor={ids.md}>יום בחודש (1–28)</label>
              <input
                id={ids.md}
                type="number"
                inputMode="numeric"
                className="input"
                min={1}
                max={28}
                value={monthDay}
                onChange={(e) => setMonthDay(Math.max(1, Math.min(28, Math.trunc(Number(e.target.value) || 1))))}
              />
            </div>
          )}
        </div>
        <fieldset className="check-list">
          <legend className="label">נמענים (חברי הלוח)</legend>
          {board.members.map((m) => (
            <label key={m.userId} className="check">
              <input
                type="checkbox"
                checked={recipients.includes(m.userId)}
                onChange={(e) => setRecipients(e.target.checked ? [...recipients, m.userId] : recipients.filter((x) => x !== m.userId))}
              />{' '}
              {m.name}
            </label>
          ))}
        </fieldset>
        <p className="hint">
          הדוח נשלח אחרי שעת התזכורות היומית: התראה במערכת, ודוא"ל למי שלא כיבה התראות דוא"ל. כולל ספירות, שמות פריטים וקישורים בלבד. מי שהוסר מהלוח לא יקבל אותו.
        </p>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
