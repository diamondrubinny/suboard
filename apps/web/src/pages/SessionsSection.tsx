import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useSessionMutations, useSessions } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { ErrorState, LoadingState, useFeedback } from '../components/Feedback';
import { Icon } from '../components/Icon';
import { formatDateTime } from './board/activityText';

/** "Where you're signed in": own devices, sign out one or all the others. */
export function SessionsSection() {
  const q = useSessions();
  const { revoke, revokeOthers } = useSessionMutations();
  const { toast, confirm } = useFeedback();
  const { logout } = useAuth();
  const navigate = useNavigate();
  const others = q.data?.filter((s) => !s.current).length ?? 0;

  return (
    <section className="card" aria-labelledby="sessions-h">
      <h2 id="sessions-h">מכשירים מחוברים</h2>
      <p className="muted">איפה החשבון שלך מחובר כרגע. אם אינך מזהה מכשיר — נתק/י אותו והחלף/י סיסמה.</p>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data && (
        <ul className="list-plain session-list">
          {q.data.map((s) => (
            <li key={s.handle} className="session-row">
              <Icon name="monitor" />
              <div>
                <strong>{s.device}</strong>
                {s.current && <span className="badge success">המכשיר הזה</span>}
                {s.viaSso && <span className="badge">התחברות ארגונית</span>}
                {s.viaPasskey && <span className="badge">מפתח גישה</span>}
                <br />
                <small className="muted">
                  פעילות אחרונה: <time dateTime={s.lastSeenAt}>{formatDateTime(s.lastSeenAt)}</time> · התחברות: <time dateTime={s.createdAt}>{formatDateTime(s.createdAt)}</time>
                </small>
              </div>
              <button
                type="button"
                className="btn btn-sm"
                disabled={revoke.isPending}
                aria-label={s.current ? 'ניתוק המכשיר הזה (התנתקות)' : `ניתוק ${s.device}`}
                onClick={async () => {
                  if (s.current && !(await confirm({ title: 'ניתוק המכשיר הזה', message: 'פעולה זו תנתק אותך מהמערכת במכשיר הזה.', confirmLabel: 'ניתוק' }))) return;
                  revoke.mutate(s.handle, {
                    onSuccess: async (r) => {
                      if (r.signedOut) {
                        await logout().catch(() => undefined);
                        navigate('/login');
                        return;
                      }
                      toast('המכשיר נותק');
                    },
                    onError: (e) => toast(errorMessage(e), 'error'),
                  });
                }}
              >
                ניתוק
              </button>
            </li>
          ))}
        </ul>
      )}
      {others > 0 && (
        <button
          type="button"
          className="btn"
          disabled={revokeOthers.isPending}
          onClick={async () => {
            if (!(await confirm({ title: 'ניתוק כל המכשירים האחרים', message: `${others} מכשירים ינותקו. במכשיר הזה תישאר/י מחובר/ת.`, confirmLabel: 'ניתוק', danger: true }))) return;
            revokeOthers.mutate(undefined, { onSuccess: () => toast('כל המכשירים האחרים נותקו'), onError: (e) => toast(errorMessage(e), 'error') });
          }}
        >
          ניתוק כל המכשירים האחרים
        </button>
      )}
    </section>
  );
}
