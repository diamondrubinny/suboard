import { formatDateHe, todayIso, type AppNotification } from '@suboard/shared';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useMarkNotificationsRead, useNotificationsPage } from '../api/hooks';
import { EmptyState, ErrorState, LoadingState } from '../components/Feedback';
import { usePageTitle } from '../components/Layout';
import { NOTIFICATION_TEXT, notifLink } from '../components/NotificationsBell';

const dayOf = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const timeOf = (iso: string) => new Intl.DateTimeFormat('he-IL', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

/** Every notification of the signed-in person (up to 200), by day, with an "unread only" view. */
export function NotificationsPage() {
  usePageTitle('התראות');
  const [unreadOnly, setUnreadOnly] = useState(false);
  const q = useNotificationsPage(unreadOnly);
  const mark = useMarkNotificationsRead();
  const today = todayIso();
  const days: { day: string; items: AppNotification[] }[] = [];
  for (const n of q.data?.notifications ?? []) {
    const day = dayOf(n.createdAt);
    const last = days[days.length - 1];
    if (last && last.day === day) last.items.push(n);
    else days.push({ day, items: [n] });
  }
  const unread = q.data?.unread ?? 0;
  return (
    <>
      <div className="page-header">
        <h1>התראות</h1>
        <div className="actions">
          <div className="segmented" role="group" aria-label="אילו התראות להציג">
            <button type="button" aria-pressed={!unreadOnly} onClick={() => setUnreadOnly(false)}>
              הכול
            </button>
            <button type="button" aria-pressed={unreadOnly} onClick={() => setUnreadOnly(true)}>
              לא נקראו{unread > 0 && <span className="num"> ({unread})</span>}
            </button>
          </div>
          <button type="button" className="btn" disabled={unread === 0 || mark.isPending} onClick={() => mark.mutate({ all: true })}>
            סימון הכול כנקרא
          </button>
        </div>
      </div>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data && days.length === 0 && (
        <div className="card">
          <EmptyState title={unreadOnly ? 'אין התראות שלא נקראו' : 'אין התראות'}>
            <p>התראות מגיעות כשמשייכים אותך לפריט, מזכירים אותך בעדכון, כשתאריך יעד מתקרב, או לפי חוקי האוטומציה של הלוחות.</p>
          </EmptyState>
        </div>
      )}
      {days.map(({ day, items }) => (
        <section key={day} className="card notif-day" aria-labelledby={`nd-${day}`}>
          <h2 id={`nd-${day}`}>{day === today ? 'היום' : formatDateHe(day)}</h2>
          <ul className="list-plain">
            {items.map((n) => {
              const to = notifLink(n);
              const text = NOTIFICATION_TEXT[n.kind](n);
              return (
                <li key={n.id} className={n.read ? 'notif-row' : 'notif-row unread'}>
                  <span className="notif-row-text">
                    {!n.read && <span className="notif-dot" aria-hidden="true" />}
                    {!n.read && <span className="sr-only">לא נקראה: </span>}
                    {to ? (
                      <Link to={to} onClick={() => !n.read && mark.mutate({ ids: [n.id] })}>
                        {text}
                      </Link>
                    ) : (
                      <span>{text}</span>
                    )}
                  </span>
                  <time className="muted num" dateTime={n.createdAt}>
                    {timeOf(n.createdAt)}
                  </time>
                  {!n.read && (
                    <button type="button" className="btn btn-ghost btn-sm" aria-label={`נקראה — סימון ההתראה: ${text}`} onClick={() => mark.mutate({ ids: [n.id] })}>
                      נקראה
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {q.data && q.data.notifications.length >= 200 && <p className="muted">מוצגות 200 ההתראות האחרונות.</p>}
    </>
  );
}
