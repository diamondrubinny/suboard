import { formatAutoId, LIMITS, type Item } from '@suboard/shared';
import { useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client';
import { useAttachmentMutations, useBoard, useItemCard, useUpdateMutations } from '../../api/hooks';
import { CameraButton } from '../../components/CameraButton';
import { CellEditor } from '../../components/cells/CellEditor';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { usePageTitle } from '../../components/Layout';
import { QrCode, qrUrl } from '../../components/QrCode';
import { formatDateTime } from '../board/activityText';

/** Mobile item card opened by scanning a QR sticker (`/q/:itemId`). */
export function QrLandingPage() {
  const { itemId = '' } = useParams();
  const q = useItemCard(itemId);
  usePageTitle(q.data?.item.name ?? 'כרטיס פריט');
  const { add } = useUpdateMutations(itemId);
  const { upload } = useAttachmentMutations(itemId);
  const { toast } = useFeedback();
  const [text, setText] = useState('');

  if (q.isPending) return <LoadingState />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404)
      return (
        <div className="state" role="alert">
          <h1>הפריט לא נמצא</h1>
          <p>ייתכן שהפריט נמחק, או שאין לך גישה ללוח שלו. לגישה פנו לבעלי הלוח.</p>
          <Link to="/" className="btn">
            ללוח הבקרה
          </Link>
        </div>
      );
    return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  }
  const c = q.data;
  const canEdit = c.myRole !== 'viewer';
  const filled = c.columns.filter((col) => col.type !== 'long_text' && c.item.values[col.id] !== undefined);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    add.mutate(
      { body: text.trim() },
      {
        onSuccess: () => {
          setText('');
          toast('הדיווח נשמר בעדכוני הפריט');
          void q.refetch();
        },
        onError: (err) => toast(errorMessage(err), 'error'),
      },
    );
  };
  const sendPhotos = async (files: FileList | null) => {
    for (const f of Array.from(files ?? [])) {
      try {
        await upload.mutateAsync(f);
        toast('התמונה הועלתה ונסרקת לאיתור נוזקות');
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    }
  };

  return (
    <article className="qr-card">
      <p className="muted qr-card-board">{c.boardName}</p>
      <h1>{c.item.name}</h1>
      <dl className="qr-fields">
        {filled.map((col) => (
          <div key={col.id} className="qr-field">
            <dt>{col.title}</dt>
            <dd>
              <CellEditor column={col} value={c.item.values[col.id]} users={c.members} readOnly label={col.title} mode="drawer" seq={c.item.seq} createdBy={c.item.createdBy} updatedAt={c.item.updatedAt} onChange={() => undefined} />
            </dd>
          </div>
        ))}
      </dl>
      <div className="toolbar">
        <Link to={`/boards/${c.boardId}?item=${c.item.id}`} className="btn btn-primary">
          פתיחה בלוח
        </Link>
        {canEdit && <CameraButton disabled={upload.isPending} label="צילום ושמירה בפריט" onFiles={(f) => void sendPhotos(f)} />}
      </div>
      {upload.isPending && (
        <p role="status" aria-live="polite">
          מעלה…
        </p>
      )}

      {canEdit && (
        <form className="card qr-report" onSubmit={submit}>
          <h2>דיווח תקלה / עדכון</h2>
          <label htmlFor="qr-report" className="label">
            מה ראית?
          </label>
          <textarea id="qr-report" className="textarea" rows={3} maxLength={LIMITS.updateBody} value={text} onChange={(e) => setText(e.target.value)} aria-describedby="qr-report-hint" />
          <p id="qr-report-hint" className="hint">
            נשמר כעדכון על הפריט, עם שמך ושעת הדיווח. ללא מידע רפואי.
          </p>
          <button type="submit" className="btn btn-primary" disabled={add.isPending || !text.trim()}>
            שליחה
          </button>
        </form>
      )}

      <section aria-labelledby="qr-updates" className="card">
        <h2 id="qr-updates">עדכונים אחרונים</h2>
        {c.updates.length === 0 ? (
          <p className="muted">אין עדכונים.</p>
        ) : (
          <ul className="list-plain">
            {c.updates.map((u) => (
              <li key={u.id} className="update">
                <strong>{u.userName}</strong> <span className="muted">· {formatDateTime(u.createdAt)}</span>
                <p className="body">{u.body}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}

/** Printable QR label sheet for a board (`/boards/:id/qr?items=a,b`). */
export function QrSheetPage() {
  const { boardId = '' } = useParams();
  const [params] = useSearchParams();
  const board = useBoard(boardId);
  usePageTitle(`מדבקות QR — ${board.data?.name ?? 'לוח'}`);
  const preselected = params.get('items')?.split(',').filter(Boolean) ?? null;
  const [selected, setSelected] = useState<string[] | null>(preselected);
  const [size, setSize] = useState<'s' | 'm' | 'l'>('m');
  if (board.isPending) return <LoadingState />;
  if (board.isError) return <ErrorState message={errorMessage(board.error)} onRetry={() => board.refetch()} />;
  const b = board.data;
  const tops = b.items.filter((i) => !i.parentId);
  const chosen = selected ?? tops.map((i) => i.id);
  const autoCol = b.columns.find((c) => c.type === 'auto_id');
  const labels: Item[] = tops.filter((i) => chosen.includes(i.id));
  const px = { s: 96, m: 140, l: 200 }[size];

  return (
    <>
      <div className="page-header no-print">
        <div>
          <h1>מדבקות QR: {b.name}</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            הקוד מוביל לכרטיס הפריט; הצפייה מחייבת התחברות והרשאה ללוח.
          </p>
        </div>
        <div className="actions">
          <label htmlFor="qr-size" className="sr-only">
            גודל מדבקה
          </label>
          <select id="qr-size" className="select" value={size} onChange={(e) => setSize(e.target.value as 's' | 'm' | 'l')}>
            <option value="s">קטנה</option>
            <option value="m">בינונית</option>
            <option value="l">גדולה</option>
          </select>
          <button type="button" className="btn btn-primary" onClick={() => window.print()} disabled={!labels.length}>
            <Icon name="printer" /> הדפסה ({labels.length})
          </button>
          <Link to={`/boards/${b.id}`} className="btn">
            חזרה ללוח
          </Link>
        </div>
      </div>
      <fieldset className="check-list no-print qr-pick">
        <legend className="label">
          פריטים להדפסה{' '}
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setSelected(chosen.length === tops.length ? [] : tops.map((i) => i.id))}>
            {chosen.length === tops.length ? 'ניקוי הכל' : 'בחירת הכל'}
          </button>
        </legend>
        {tops.map((i) => (
          <label key={i.id} className="check">
            <input type="checkbox" checked={chosen.includes(i.id)} onChange={(e) => setSelected(e.target.checked ? [...chosen, i.id] : chosen.filter((x) => x !== i.id))} /> {i.name}
          </label>
        ))}
      </fieldset>
      <ul className={`list-plain qr-sheet qr-sheet-${size}`} aria-label="תצוגה מקדימה של המדבקות">
        {labels.map((i) => (
          <li key={i.id} className="qr-label">
            <QrCode value={qrUrl(i.id)} size={px} label={`קוד QR לפריט ${i.name}`} />
            <span className="qr-label-name">{i.name}</span>
            <span className="qr-label-meta">
              {autoCol ? formatAutoId(i.seq, autoCol.settings.prefix) : `#${i.seq}`} · {b.name}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
