import { addDaysIso, formatDateHe, todayIso, type MyWorkItem } from '@suboard/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useCompleteWork, useMyWork } from '../api/hooks';
import { EmptyState, ErrorState, LoadingState, useFeedback } from '../components/Feedback';
import { usePageTitle } from '../components/Layout';
import { StatusPill } from '../components/StatusPill';

type Bucket = 'late' | 'today' | 'week' | 'later' | 'none';
const BUCKETS: [Bucket, string][] = [
  ['late', 'באיחור'],
  ['today', 'היום'],
  ['week', 'השבוע הקרוב'],
  ['later', 'בהמשך'],
  ['none', 'ללא תאריך יעד'],
];

/** "My work": every open item and sub-item assigned to me, across boards, grouped by due date. */
export function MyWorkPage() {
  usePageTitle('המשימות שלי');
  const q = useMyWork();
  const complete = useCompleteWork();
  const { toast } = useFeedback();
  const [closing, setClosing] = useState<Set<string>>(new Set());
  const today = todayIso();
  const week = addDaysIso(today, 7);
  const bucketOf = (i: MyWorkItem): Bucket => (!i.dueDate ? 'none' : i.dueDate < today ? 'late' : i.dueDate === today ? 'today' : i.dueDate <= week ? 'week' : 'later');

  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  const items = q.data;

  const markDone = (i: MyWorkItem) => {
    if (!i.complete) return;
    const c = i.complete;
    const settle = () => setClosing((x) => (x.delete(i.itemId), new Set(x)));
    setClosing((x) => new Set(x).add(i.itemId)); // shown as done at once, until the list refreshes
    complete.mutate(
      { itemId: i.itemId, boardId: i.boardId, columnId: c.columnId, optionId: c.optionId },
      {
        onSuccess: () =>
          toast(
            `"${i.itemName}" סומן כבוצע`,
            'info',
            {
              label: 'ביטול',
              onClick: () =>
                complete.mutate({ itemId: i.itemId, boardId: i.boardId, columnId: c.columnId, optionId: i.statusId }, { onSuccess: () => toast('השינוי בוטל', 'info', undefined, 'undo'), onError: (e) => toast(errorMessage(e), 'error') }),
            },
            'undo',
          ),
        onError: (e) => (settle(), toast(errorMessage(e), 'error')),
        onSettled: () => window.setTimeout(settle, 1500),
      },
    );
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>המשימות שלי</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            כל הפריטים ותת-הפריטים הפתוחים שמשויכים אליך, מכל הלוחות. {items.length > 0 && <strong>{items.length} פתוחים.</strong>}
          </p>
        </div>
      </div>
      {items.length === 0 && (
        <div className="card">
          <EmptyState title="אין משימות פתוחות">
            <p>כשישייכו אותך לפריט או לתת-פריט, הוא יופיע כאן.</p>
          </EmptyState>
        </div>
      )}
      {BUCKETS.map(([key, title]) => {
        const list = items.filter((i) => bucketOf(i) === key);
        if (!list.length) return null;
        return (
          <section key={key} className="card mywork-group" aria-labelledby={`mw-${key}`}>
            <h2 id={`mw-${key}`}>
              {title} <span className={key === 'late' ? 'badge danger' : 'badge'}>{list.length}</span>
            </h2>
            <ul className="list-plain subtask-list">
              {list.map((i) => (
                <li key={i.itemId} className={`subtask${closing.has(i.itemId) ? ' done' : ''}`}>
                  {i.complete && (
                    <input type="checkbox" checked={closing.has(i.itemId)} disabled={closing.has(i.itemId)} aria-label={`בוצע: ${i.itemName}`} onChange={() => markDone(i)} />
                  )}
                  <Link to={`/boards/${i.boardId}?item=${i.itemId}`} className="subtask-name">
                    {i.itemName}
                  </Link>
                  <span className="subtask-meta">
                    <span className="muted">
                      {i.boardName}
                      {i.parentName && <> · תחת "{i.parentName}"</>}
                      {i.viaTeam && <> · דרך הצוות "{i.viaTeam}"</>}
                    </span>
                    {i.dueDate && <span className={key === 'late' ? 'badge danger' : 'muted'}>{formatDateHe(i.dueDate)}</span>}
                    {i.statusLabel && <StatusPill label={i.statusLabel} color={i.statusColor} />}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}
