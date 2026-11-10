import type { AppNotification } from '@suboard/shared';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMarkNotificationsRead, useNotifications } from '../api/hooks';
import { formatDateTime } from '../pages/board/activityText';
import { Icon } from './Icon';

const TEXT: Record<AppNotification['kind'], (n: AppNotification) => string> = {
  assigned: (n) => (n.actorName ? `${n.actorName} שייך/ה אותך ל"${n.title}"` : `שויכת אוטומטית ל"${n.title}"`),
  overdue: (n) => `באיחור: "${n.title}"`,
  due_tomorrow: (n) => `תאריך יעד מחר: "${n.title}"`,
  mentioned: (n) => `${n.actorName ?? 'מישהו'} הזכיר/ה אותך ב"${n.title}"`,
  automation: (n) => `${n.detail ?? 'אוטומציה'}: "${n.title}"`,
  effectiveness: (n) => `הגיע מועד בדיקת אפקטיביות: "${n.title}"`,
  report: (n) => `${n.detail ?? 'דוח מתוזמן'} — לוח "${n.title}"`,
};

/** Header notifications: disclosure button + panel (Escape / outside click closes, focus returns). */
export function NotificationsBell() {
  const q = useNotifications();
  const mark = useMarkNotificationsRead();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const unread = q.data?.unread ?? 0;

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('.notif-panel a, .notif-panel button')?.focus();
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="notif" ref={rootRef}>
      <button
        ref={btnRef}
        type="button"
        className="icon-btn notif-btn"
        aria-expanded={open}
        aria-controls="notif-panel"
        aria-label={unread ? `התראות, ${unread} חדשות` : 'התראות'}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="bell" />
        {unread > 0 && (
          <span className="notif-count" aria-hidden="true">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div id="notif-panel" className="notif-panel card" role="region" aria-label="התראות">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
            <h2 style={{ margin: 0, fontSize: '1rem', flex: 1 }}>התראות</h2>
            {unread > 0 && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => mark.mutate({ all: true })}>
                סימון הכל כנקרא
              </button>
            )}
          </div>
          {q.data?.notifications.length === 0 && <p className="muted">אין התראות.</p>}
          <ul className="list-plain">
            {q.data?.notifications.map((n) => (
              <li key={n.id} className={n.read ? 'notif-item' : 'notif-item unread'}>
                {n.boardId && (n.itemId || n.kind === 'report') ? (
                  <Link
                    to={n.itemId ? `/boards/${n.boardId}?item=${n.itemId}` : `/boards/${n.boardId}/report`}
                    onClick={() => {
                      if (!n.read) mark.mutate({ ids: [n.id] });
                      setOpen(false);
                    }}
                  >
                    {!n.read && <span className="sr-only">חדש: </span>}
                    {TEXT[n.kind](n)}
                  </Link>
                ) : (
                  <span>{TEXT[n.kind](n)}</span>
                )}
                <br />
                <time className="muted" dateTime={n.createdAt} style={{ fontSize: '0.8rem' }}>
                  {formatDateTime(n.createdAt)}
                </time>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
