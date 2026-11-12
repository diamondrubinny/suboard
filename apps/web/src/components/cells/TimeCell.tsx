import { formatDuration, todayIso, type TimeTotal } from '@suboard/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '../../api/client';
import { useItemTime, useTimeMutations } from '../../api/hooks';
import { DateField } from '../DateField';
import { Dialog } from '../Dialog';
import { ErrorState, LoadingState, useFeedback } from '../Feedback';
import { formatDateTime } from '../../pages/board/activityText';

interface Props {
  boardId: string;
  itemId: string;
  total: TimeTotal | undefined;
  /** Editors may log time; viewers only see the total. */
  canLog: boolean;
  label: string;
  mode: 'table' | 'drawer';
  id?: string;
}

/** Seconds on the item right now, counting the viewer's own running timer live. */
function useLiveSeconds(total: TimeTotal | undefined): number {
  const [now, setNow] = useState(() => Date.now());
  const running = total?.runningSince ?? null;
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(t);
  }, [running]);
  return (total?.seconds ?? 0) + (running ? Math.max(0, Math.floor((now - Date.parse(running)) / 1000)) : 0);
}

/** Time-tracking cell: the item's total, a start / stop button, and a dialog with the details. */
export function TimeCell({ boardId, itemId, total, canLog, label, mode, id }: Props) {
  const [open, setOpen] = useState(false);
  const { start, stop } = useTimeMutations(boardId, itemId);
  const { toast } = useFeedback();
  const seconds = useLiveSeconds(total);
  const running = Boolean(total?.runningSince);
  const text = seconds > 0 || running ? formatDuration(seconds) : '—';
  const onErr = (e: unknown) => toast(errorMessage(e), 'error');

  return (
    <span className="time-cell" id={id}>
      <button type="button" className="long-text-btn num" onClick={() => setOpen(true)} aria-label={`${text === '—' ? 'לא נרשם זמן' : `${text} שעות`} — ${label}: פירוט ורישום זמן`}>
        {text}
        {running && <span className="time-running" aria-hidden="true" />}
      </button>
      {canLog && (
        <button
          type="button"
          className="icon-btn time-toggle"
          disabled={start.isPending || stop.isPending}
          aria-pressed={running}
          aria-label={running ? `עצירת השעון: ${label}` : `הפעלת שעון: ${label}`}
          onClick={() => (running ? stop.mutate(undefined, { onSuccess: () => toast('השעון נעצר'), onError: onErr }) : start.mutate(undefined, { onSuccess: () => toast('השעון פועל. שעון שרץ בפריט אחר נעצר.'), onError: onErr }))}
        >
          <span aria-hidden="true">{running ? '■' : '▶'}</span>
        </button>
      )}
      {mode === 'drawer' && (total?.othersRunning ?? 0) > 0 && <span className="muted"> · שעון פעיל אצל {total!.othersRunning} נוספים</span>}
      {open && <TimeDialog boardId={boardId} itemId={itemId} canLog={canLog} label={label} onClose={() => setOpen(false)} />}
    </span>
  );
}

function TimeDialog({ boardId, itemId, canLog, label, onClose }: { boardId: string; itemId: string; canLog: boolean; label: string; onClose: () => void }) {
  const q = useItemTime(itemId);
  const { addManual, update, remove } = useTimeMutations(boardId, itemId);
  const [editing, setEditing] = useState<string | null>(null);
  const { toast } = useFeedback();
  const [hours, setHours] = useState('');
  const [minutes, setMinutes] = useState('');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const total = (Number(hours) || 0) * 60 + (Number(minutes) || 0);
    if (!Number.isInteger(total) || total < 1) return setError('יש להזין זמן (שעות ו/או דקות)');
    if (total > 720) return setError('עד 12 שעות ברישום אחד');
    if (!date) return setError('יש לבחור תאריך');
    setError(null);
    const input = { minutes: total, date, note: note.trim() || undefined };
    const done = (msg: string) => () => (reset(), toast(msg));
    if (editing) update.mutate({ id: editing, ...input }, { onSuccess: done('הרישום עודכן'), onError: (err) => setError(errorMessage(err)) });
    else addManual.mutate(input, { onSuccess: done('הזמן נרשם'), onError: (err) => setError(errorMessage(err)) });
  };
  const reset = () => (setEditing(null), setHours(''), setMinutes(''), setNote(''), setDate(todayIso()), setError(null));
  const startEdit = (en: { id: string; seconds: number; startedAt: string; note: string }) => {
    const m = Math.max(1, Math.round(en.seconds / 60));
    setEditing(en.id);
    setHours(String(Math.floor(m / 60)));
    setMinutes(String(m % 60));
    setDate(en.startedAt.slice(0, 10));
    setNote(en.note);
    setError(null);
    document.getElementById('tm-h')?.focus();
  };

  return (
    <Dialog open onClose={onClose} title={`מעקב זמן: ${label}`}>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data && (
        <>
          <p>
            סה"כ בפריט: <strong className="num">{formatDuration(q.data.totalSeconds)}</strong> שעות
            {!q.data.detailed && (
              <>
                {' '}
                · שלך: <strong className="num">{formatDuration(q.data.mineSeconds)}</strong>
              </>
            )}
          </p>
          <p className="hint">{q.data.detailed ? 'כבעל/ת הלוח את/ה רואה את הרישומים של כולם.' : 'כל חברי הלוח רואים את הסך הכולל. את הפירוט שלך רואים רק את/ה ובעלי הלוח.'}</p>
          {q.data.entries.length > 0 && (
            <table className="data-table">
              <caption className="sr-only">{q.data.detailed ? 'רישומי הזמן בפריט' : 'רישומי הזמן שלי בפריט'}</caption>
              <thead>
                <tr>
                  {q.data.detailed && <th scope="col">מי</th>}
                  <th scope="col">מתי</th>
                  <th scope="col">משך</th>
                  <th scope="col">הערה</th>
                  <th scope="col">
                    <span className="sr-only">פעולות</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {q.data.entries.map((en) => (
                  <tr key={en.id}>
                    {q.data.detailed && <td>{en.userName}</td>}
                    <td>
                      <time dateTime={en.startedAt}>{formatDateTime(en.startedAt)}</time>
                    </td>
                    <td className="num">{en.endedAt ? formatDuration(en.seconds) : `${formatDuration(en.seconds)} (פועל)`}</td>
                    <td>{en.note}</td>
                    <td>
                      {en.endedAt && en.mine && canLog && (
                        <button type="button" className="btn btn-sm" aria-pressed={editing === en.id} aria-label={`עריכה: רישום של ${formatDuration(en.seconds)} מ-${formatDateTime(en.startedAt)}`} onClick={() => startEdit(en)}>
                          עריכה
                        </button>
                      )}{' '}
                      {en.endedAt && (en.mine || q.data.detailed) && (
                        <button type="button" className="btn btn-sm" disabled={remove.isPending} aria-label={`מחיקה: רישום של ${formatDuration(en.seconds)} מ-${formatDateTime(en.startedAt)}`} onClick={() => remove.mutate(en.id, { onSuccess: () => toast('הרישום נמחק'), onError: (e) => toast(errorMessage(e), 'error') })}>
                          מחיקה
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {canLog && (
            <form onSubmit={submit} noValidate className="time-manual">
              <h3>{editing ? 'עריכת רישום זמן' : 'רישום זמן ידני'}</h3>
              {error && (
                <div className="form-error" role="alert">
                  {error}
                </div>
              )}
              <div className="time-manual-row">
                <div className="field">
                  <label htmlFor="tm-h">שעות</label>
                  <input id="tm-h" type="number" className="input" min={0} max={12} inputMode="numeric" value={hours} onChange={(e) => setHours(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="tm-m">דקות</label>
                  <input id="tm-m" type="number" className="input" min={0} max={59} inputMode="numeric" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
                </div>
                <div className="field">
                  <label htmlFor="tm-d">תאריך</label>
                  <DateField id="tm-d" value={date} max={todayIso()} onChange={setDate} />
                </div>
              </div>
              <div className="field">
                <label htmlFor="tm-n">הערה (לא חובה)</label>
                <input id="tm-n" className="input" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} />
              </div>
              <button type="submit" className="btn btn-primary" disabled={addManual.isPending || update.isPending}>
                {editing ? 'שמירת השינוי' : 'רישום'}
              </button>{' '}
              {editing && (
                <button type="button" className="btn" onClick={reset}>
                  ביטול העריכה
                </button>
              )}
            </form>
          )}
        </>
      )}
    </Dialog>
  );
}
