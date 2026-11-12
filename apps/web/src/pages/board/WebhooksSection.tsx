import { WEBHOOK_EVENT_LABELS, WEBHOOK_EVENTS, type BoardDetail, type Webhook, type WebhookEvent } from '@suboard/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../api/client';
import { useWebhookDeliveries, useWebhookMutations, useWebhooks } from '../../api/hooks';
import { Dialog } from '../../components/Dialog';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { formatDateTime } from './activityText';

/** Board owners: send a signed message to an external HTTPS address when items are created or changed. */
export function WebhooksSection({ board }: { board: BoardDetail }) {
  const q = useWebhooks(board.id);
  const { create, update, remove, test } = useWebhookMutations(board.id);
  const { toast, confirm } = useFeedback();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<WebhookEvent[]>(['item_created', 'item_updated']);
  const [error, setError] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const [logFor, setLogFor] = useState<Webhook | null>(null);
  const onErr = (e: unknown) => toast(errorMessage(e), 'error');

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!/^https:\/\//i.test(url.trim())) return setError('הכתובת חייבת להתחיל ב-https://');
    if (!events.length) return setError('יש לבחור לפחות אירוע אחד');
    setError(null);
    create.mutate(
      { url: url.trim(), events },
      {
        onSuccess: (r) => {
          setUrl('');
          setSecret(r.secret);
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };

  return (
    <section className="card" aria-labelledby="hooks-h">
      <h2 id="hooks-h">Webhooks</h2>
      <p className="muted">
        הודעה חתומה נשלחת לכתובת HTTPS חיצונית כשפריט בלוח נוצר או משתנה (למשל ל-Power Automate). <strong>המידע יוצא מהמערכת:</strong> שם הפריט וערכי העמודות שלו כטקסט — בלי כתובות דוא"ל, בלי עדכונים ובלי קבצים. שלחו רק למערכת שהיחידה אחראית עליה.
      </p>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data && q.data.length > 0 && (
        <ul className="list-plain item-list" aria-label="Webhooks של הלוח">
          {q.data.map((h) => (
            <li key={h.id} style={{ display: 'block' }}>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
                <code dir="ltr" className="qr-url">
                  {new URL(h.url).host}
                </code>
                <span className={h.active ? 'badge success' : 'badge'}>{h.active ? 'פעיל' : h.failures >= 10 ? 'כובה אחרי כישלונות חוזרים' : 'מושהה'}</span>
                <span className="muted">{h.events.map((e) => WEBHOOK_EVENT_LABELS[e]).join(', ')}</span>
                <span style={{ marginInlineStart: 'auto', display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-sm" disabled={test.isPending} onClick={() => test.mutate(h.id, { onSuccess: (d) => toast(d.ok ? 'הבדיקה הצליחה: היעד ענה' : `הבדיקה נכשלה: ${d.error ?? 'שגיאה'}`, d.ok ? 'info' : 'error'), onError: onErr })}>
                    בדיקה<span className="sr-only"> של {new URL(h.url).host}</span>
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setLogFor(h)}>
                    יומן<span className="sr-only"> המסירות של {new URL(h.url).host}</span>
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => update.mutate({ id: h.id, patch: { active: !h.active } }, { onSuccess: () => toast(h.active ? 'ה-Webhook הושהה' : 'ה-Webhook הופעל'), onError: onErr })}>
                    {h.active ? 'השהיה' : 'הפעלה'}
                    <span className="sr-only"> של {new URL(h.url).host}</span>
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm"
                    onClick={async () => {
                      if (await confirm({ title: 'מחיקת Webhook', message: `להפסיק לשלוח הודעות אל ${new URL(h.url).host}? יומן המסירות יימחק.`, confirmLabel: 'מחיקה', danger: true }))
                        remove.mutate(h.id, { onSuccess: () => toast('ה-Webhook נמחק'), onError: onErr });
                    }}
                  >
                    מחיקה<span className="sr-only"> של {new URL(h.url).host}</span>
                  </button>
                </span>
              </div>
              {h.last && (
                <small className="muted">
                  מסירה אחרונה: {h.last.ok ? 'הצליחה' : `נכשלה — ${h.last.error ?? ''}`} · <time dateTime={h.last.at}>{formatDateTime(h.last.at)}</time>
                </small>
              )}
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} noValidate>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor="hook-url">כתובת היעד (HTTPS)</label>
          <input id="hook-url" className="input" dir="ltr" type="url" inputMode="url" placeholder="https://" value={url} maxLength={500} onChange={(e) => setUrl(e.target.value)} aria-describedby="hook-url-hint" />
          <span id="hook-url-hint" className="hint">
            רק https, בלי שם משתמש וסיסמה בכתובת, ולא כתובת ברשת הפנימית.
          </span>
        </div>
        <fieldset className="check-list">
          <legend className="label">מתי לשלוח</legend>
          {WEBHOOK_EVENTS.map((e) => (
            <label key={e} className="check">
              <input type="checkbox" checked={events.includes(e)} onChange={(ev) => setEvents((cur) => (ev.target.checked ? [...cur, e] : cur.filter((x) => x !== e)))} /> {WEBHOOK_EVENT_LABELS[e]}
            </label>
          ))}
        </fieldset>
        <button type="submit" className="btn" disabled={create.isPending}>
          הוספת Webhook
        </button>
      </form>

      <Dialog open={secret !== null} onClose={() => setSecret(null)} title="סוד החתימה של ה-Webhook">
        <p>
          זה המפתח שבו נחתמת כל הודעה. <strong>הוא מוצג פעם אחת בלבד</strong> — העתיקו אותו עכשיו למערכת המקבלת.
        </p>
        <div className="field">
          <label htmlFor="hook-secret">סוד החתימה</label>
          <input id="hook-secret" className="input" dir="ltr" readOnly value={secret ?? ''} onFocus={(e) => e.target.select()} />
        </div>
        <p className="hint">
          המערכת המקבלת מאמתת את הכותרת <code dir="ltr">X-SUBoard-Signature</code>: HMAC-SHA256 של <code dir="ltr">timestamp.body</code> עם הסוד, כאשר ה-timestamp מגיע בכותרת <code dir="ltr">X-SUBoard-Timestamp</code>.
        </p>
        <button
          type="button"
          className="btn btn-primary"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(secret ?? '');
              toast('הסוד הועתק');
            } catch {
              toast('ההעתקה נכשלה — סמנו והעתיקו ידנית', 'error');
            }
          }}
        >
          העתקה
        </button>
      </Dialog>
      {logFor && <DeliveryLog hook={logFor} onClose={() => setLogFor(null)} />}
    </section>
  );
}

function DeliveryLog({ hook, onClose }: { hook: Webhook; onClose: () => void }) {
  const q = useWebhookDeliveries(hook.id);
  return (
    <Dialog open onClose={onClose} title={`יומן מסירות: ${new URL(hook.url).host}`}>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data && q.data.length === 0 && <p className="muted">עדיין לא נשלחה אף הודעה.</p>}
      {q.data && q.data.length > 0 && (
        <table className="data-table">
          <caption className="sr-only">30 המסירות האחרונות</caption>
          <thead>
            <tr>
              <th scope="col">מתי</th>
              <th scope="col">אירוע</th>
              <th scope="col">תוצאה</th>
            </tr>
          </thead>
          <tbody>
            {q.data.map((d) => (
              <tr key={d.id}>
                <td>
                  <time dateTime={d.at}>{formatDateTime(d.at)}</time>
                </td>
                <td>{d.event === 'ping' ? 'בדיקה' : (WEBHOOK_EVENT_LABELS[d.event as WebhookEvent] ?? d.event)}</td>
                <td>{d.ok ? `הצליחה (${d.status})` : `נכשלה — ${d.error ?? ''}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Dialog>
  );
}
