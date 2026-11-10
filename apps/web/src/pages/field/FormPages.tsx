import {
  createFormSchema,
  FORM_FIELD_TYPES,
  formatDateHe,
  LIMITS,
  MEMBER_FORM_FIELD_TYPES,
  type BoardDetail,
  type BoardForm,
  type CellValue,
  type ColumnType,
  type FormField,
} from '@suboard/shared';
import { useId, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client';
import { useAvailableForms, useBoard, useBoardForms, useFormForFill, useFormMutations, useMySubmissions, useSubmitForm } from '../../api/hooks';
import { CameraButton } from '../../components/CameraButton';
import { CellEditor } from '../../components/cells/CellEditor';
import { Dialog } from '../../components/Dialog';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { usePageTitle } from '../../components/Layout';
import { StatusPill } from '../../components/StatusPill';

// ---------------------------------------------------------------- management
export function FormsAdminPage() {
  const { boardId = '' } = useParams();
  const board = useBoard(boardId);
  const forms = useBoardForms(boardId);
  const { update, remove } = useFormMutations(boardId);
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState<BoardForm | 'new' | null>(null);
  usePageTitle(`טפסים — ${board.data?.name ?? 'לוח'}`);
  if (board.isPending) return <LoadingState />;
  if (board.isError) return <ErrorState message={errorMessage(board.error)} onRetry={() => board.refetch()} />;
  const b = board.data;
  if (b.myRole !== 'owner')
    return (
      <div className="state" role="alert">
        <h1>אין הרשאה</h1>
        <p>רק בעלי הלוח מנהלים טפסים.</p>
      </div>
    );
  const link = (f: BoardForm) => `${window.location.origin}/forms/${f.id}`;

  return (
    <>
      <div className="page-header">
        <div>
          <h1>טפסים: {b.name}</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            כל טופס יוצר פריט בלוח. המילוי מחייב התחברות.
          </p>
        </div>
        <div className="actions">
          <button type="button" className="btn btn-primary" onClick={() => setEditing('new')}>
            <Icon name="plus" /> טופס חדש
          </button>
          <Link to={`/boards/${b.id}/settings`} className="btn">
            חזרה להגדרות
          </Link>
        </div>
      </div>
      {forms.isPending && <LoadingState />}
      {forms.isError && <ErrorState message={errorMessage(forms.error)} onRetry={() => forms.refetch()} />}
      {forms.data?.length === 0 && (
        <div className="empty-state">
          <Icon name="clipboard" />
          <p>אין טפסים. למשל: "דיווח כמעט-אירוע" לכל המשתמשים, או "בקשה לסקר" לחברי הלוח.</p>
        </div>
      )}
      <ul className="list-plain automation-list">
        {forms.data?.map((f) => (
          <li key={f.id} className={f.enabled ? 'automation-card' : 'automation-card disabled'}>
            <div className="automation-card-head">
              <h3>{f.name}</h3>
              <label className="switch">
                <input type="checkbox" role="switch" checked={f.enabled} aria-label={`הטופס "${f.name}" פעיל`} onChange={(e) => update.mutate({ id: f.id, patch: { enabled: e.target.checked } }, { onError: (err) => toast(errorMessage(err), 'error') })} />
                <span aria-hidden="true">{f.enabled ? 'פעיל' : 'כבוי'}</span>
              </label>
            </div>
            <p className="rule-sentence">
              {f.audience === 'all_users' ? 'לכל המשתמשים המחוברים' : 'לחברי הלוח (עורכים ובעלים)'} · {f.fields.length} שדות{f.allowPhotos ? ' · כולל תמונות' : ''} · {f.submissions} דיווחים
            </p>
            <p className="automation-meta">
              קישור: <code className="qr-url">{link(f)}</code>
            </p>
            <div className="actions">
              <Link className="btn btn-sm" to={`/forms/${f.id}`}>
                תצוגה ומילוי<span className="sr-only"> של {f.name}</span>
              </Link>
              <button type="button" className="btn btn-sm" onClick={() => setEditing(f)}>
                עריכה<span className="sr-only"> של {f.name}</span>
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  if (await confirm({ title: 'מחיקת טופס', message: `למחוק את הטופס "${f.name}"? פריטים שכבר דווחו יישארו בלוח.`, confirmLabel: 'מחיקה', danger: true })) {
                    remove.mutate(f.id, { onSuccess: () => toast('הטופס נמחק'), onError: (err) => toast(errorMessage(err), 'error') });
                  }
                }}
              >
                מחיקה<span className="sr-only"> של {f.name}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
      {editing && <FormEditor key={editing === 'new' ? 'new' : editing.id} board={b} form={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function FormEditor({ board, form, onClose }: { board: BoardDetail; form: BoardForm | null; onClose: () => void }) {
  const { create, update } = useFormMutations(board.id);
  const { toast } = useFeedback();
  const [name, setName] = useState(form?.name ?? '');
  const [description, setDescription] = useState(form?.description ?? '');
  const [groupId, setGroupId] = useState(form?.groupId ?? board.groups[0]?.id ?? '');
  const [nameLabel, setNameLabel] = useState(form?.nameLabel ?? 'כותרת');
  const [audience, setAudience] = useState<'members' | 'all_users'>(form?.audience ?? 'members');
  const [allowPhotos, setAllowPhotos] = useState(form?.allowPhotos ?? false);
  const [fields, setFields] = useState<FormField[]>(form?.fields ?? []);
  const [error, setError] = useState<string | null>(null);
  const ids = { n: useId(), d: useId(), g: useId(), nl: useId() };
  const allowed: readonly ColumnType[] = audience === 'all_users' ? FORM_FIELD_TYPES : MEMBER_FORM_FIELD_TYPES;
  const pending = create.isPending || update.isPending;

  const toggle = (columnId: string, on: boolean) => setFields(on ? [...fields, { columnId, required: false }] : fields.filter((f) => f.columnId !== columnId));
  const patchField = (columnId: string, patch: Partial<FormField>) => setFields(fields.map((f) => (f.columnId === columnId ? { ...f, ...patch } : f)));

  const save = () => {
    setError(null);
    const parsed = createFormSchema.safeParse({ name, description, groupId, nameLabel, audience, allowPhotos, fields: fields.filter((f) => allowed.includes(board.columns.find((c) => c.id === f.columnId)?.type as ColumnType)), enabled: form?.enabled ?? true });
    if (!parsed.success) return setError(parsed.error.issues[0]?.path[0] === 'name' ? 'יש לתת שם לטופס' : (parsed.error.issues[0]?.message ?? 'יש להשלים את השדות'));
    const done = () => (toast(form ? 'הטופס עודכן' : 'הטופס נוצר'), onClose());
    if (form) update.mutate({ id: form.id, patch: parsed.data }, { onSuccess: done, onError: (e) => setError(errorMessage(e)) });
    else create.mutate(parsed.data, { onSuccess: done, onError: (e) => setError(errorMessage(e)) });
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={form ? `עריכת טופס: ${form.name}` : 'טופס חדש'}
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
          <label htmlFor={ids.n}>שם הטופס</label>
          <input id={ids.n} className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="דיווח כמעט-אירוע" />
        </div>
        <div className="field">
          <label htmlFor={ids.d}>הסבר למילוי (לא חובה)</label>
          <textarea id={ids.d} className="textarea" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <fieldset className="check-list">
          <legend className="label">מי יכול למלא</legend>
          <label className="check">
            <input type="radio" name="aud" checked={audience === 'members'} onChange={() => setAudience('members')} /> חברי הלוח (עורכים ובעלים)
          </label>
          <label className="check">
            <input type="radio" name="aud" checked={audience === 'all_users'} onChange={() => setAudience('all_users')} /> כל המשתמשים המחוברים
          </label>
        </fieldset>
        {audience === 'all_users' && <p className="hint">הממלאים לא רואים את הלוח — רק את הדיווחים שלהם ואת הסטטוס. עמודות אנשים לא זמינות בטופס כזה.</p>}
        <div className="rule-row">
          <div className="field">
            <label htmlFor={ids.g}>הפריט נוצר בקבוצה</label>
            <select id={ids.g} className="select" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
              {board.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.nl}>תווית שדה הכותרת</label>
            <input id={ids.nl} className="input" maxLength={80} value={nameLabel} onChange={(e) => setNameLabel(e.target.value)} />
          </div>
        </div>
        <fieldset className="rule-block">
          <legend>
            <span className="rule-kw">שדות</span>
          </legend>
          {board.columns.map((c) => {
            const ok = allowed.includes(c.type);
            const f = fields.find((x) => x.columnId === c.id);
            return (
              <div key={c.id} className="form-field-row">
                <label className="check">
                  <input type="checkbox" disabled={!ok} checked={Boolean(f) && ok} onChange={(e) => toggle(c.id, e.target.checked)} /> {c.title}
                  {!ok && <span className="muted"> (לא זמין בטופס זה)</span>}
                </label>
                {f && ok && (
                  <div className="rule-row">
                    <input className="input" aria-label={`תווית בטופס עבור ${c.title}`} placeholder={c.title} maxLength={LIMITS.columnTitle} value={f.label ?? ''} onChange={(e) => patchField(c.id, { label: e.target.value || undefined })} />
                    <input className="input" aria-label={`הסבר עבור ${c.title}`} placeholder="הסבר (לא חובה)" maxLength={300} value={f.help ?? ''} onChange={(e) => patchField(c.id, { help: e.target.value || undefined })} />
                    <label className="check">
                      <input type="checkbox" checked={f.required} onChange={(e) => patchField(c.id, { required: e.target.checked })} /> חובה
                    </label>
                  </div>
                )}
              </div>
            );
          })}
        </fieldset>
        <label className="check">
          <input type="checkbox" checked={allowPhotos} onChange={(e) => setAllowPhotos(e.target.checked)} /> לאפשר צירוף עד {LIMITS.formPhotos} תמונות (נסרקות לאיתור נוזקות)
        </label>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- list + my submissions
export function FormsPage() {
  usePageTitle('טפסים ודיווחים');
  const forms = useAvailableForms();
  const mine = useMySubmissions();
  return (
    <>
      <div className="page-header">
        <div>
          <h1>טפסים ודיווחים</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            דיווח מהיר ליחידת הבטיחות. אין להזין מידע רפואי או פרטים מזהים של נפגעים.
          </p>
        </div>
      </div>
      <section aria-labelledby="forms-avail" className="card">
        <h2 id="forms-avail">טפסים זמינים</h2>
        {forms.isPending && <LoadingState />}
        {forms.isError && <ErrorState message={errorMessage(forms.error)} onRetry={() => forms.refetch()} />}
        {forms.data?.length === 0 && <p className="muted">אין טפסים זמינים עבורך כרגע.</p>}
        <ul className="list-plain form-list">
          {forms.data?.map((f) => (
            <li key={f.id}>
              <Link to={`/forms/${f.id}`} className="form-link">
                <strong>{f.name}</strong>
                {f.description && <span className="muted">{f.description}</span>}
              </Link>
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="forms-mine" className="card" style={{ marginTop: 'var(--space-4)' }}>
        <h2 id="forms-mine">הדיווחים שלי</h2>
        {mine.isPending && <LoadingState />}
        {mine.data?.length === 0 && <p className="muted">עוד לא שלחת דיווחים.</p>}
        {mine.data && mine.data.length > 0 && (
          <div className="table-scroll" tabIndex={0} role="region" aria-label="טבלת הדיווחים שלי">
            <table className="data-table">
              <caption className="sr-only">הדיווחים שלי</caption>
              <thead>
                <tr>
                  <th scope="col">אסמכתא</th>
                  <th scope="col">דיווח</th>
                  <th scope="col">טופס</th>
                  <th scope="col">תאריך</th>
                  <th scope="col">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {mine.data.map((s) => (
                  <tr key={s.itemId}>
                    <td className="num">{s.ref}</td>
                    <td>{s.name}</td>
                    <td>{s.formName}</td>
                    <td>{formatDateHe(s.createdAt.slice(0, 10))}</td>
                    <td>{s.statusLabel ? <StatusPill label={s.statusLabel} color={s.statusColor} /> : <span className="muted">התקבל</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

// ---------------------------------------------------------------- fill
export function FormFillPage() {
  const { formId = '' } = useParams();
  const q = useFormForFill(formId);
  const { submit, photo } = useSubmitForm(formId);
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const [values, setValues] = useState<Record<string, CellValue>>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ itemId: string; ref: string } | null>(null);
  const [photos, setPhotos] = useState(0);
  usePageTitle(q.data?.name ?? 'טופס');

  if (q.isPending) return <LoadingState />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404)
      return (
        <div className="state" role="alert">
          <h1>הטופס לא זמין</h1>
          <p>ייתכן שהטופס הושבת או שאינו מיועד לך.</p>
          <Link to="/forms" className="btn">
            לטפסים הזמינים
          </Link>
        </div>
      );
    return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  }
  const f = q.data;

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError(`השדה "${f.nameLabel}" הוא חובה`);
    const missing = f.fields.find((x) => x.required && (values[x.columnId] === undefined || values[x.columnId] === null));
    if (missing) return setError(`השדה "${missing.label ?? missing.column.title}" הוא חובה`);
    const clean = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== null && v !== undefined));
    submit.mutate({ name: name.trim(), values: clean }, { onSuccess: (r) => setDone(r), onError: (err) => setError(errorMessage(err)) });
  };
  const sendPhotos = async (files: FileList | null) => {
    if (!done) return;
    for (const file of Array.from(files ?? [])) {
      try {
        await photo.mutateAsync({ itemId: done.itemId, file });
        setPhotos((n) => n + 1);
      } catch (err) {
        toast(errorMessage(err), 'error');
      }
    }
  };

  if (done)
    return (
      <div className="form-page">
        <div className="card form-done" role="status">
          <h1>
            <Icon name="checks" /> הדיווח התקבל
          </h1>
          <p>
            מספר אסמכתא: <strong className="num">{done.ref}</strong>. יחידת הבטיחות תטפל בו; אפשר לעקוב אחרי הסטטוס ב"הדיווחים שלי".
          </p>
          {f.allowPhotos && (
            <div className="form-photos">
              <p>אפשר לצרף עד {LIMITS.formPhotos} תמונות בשעה הקרובה:</p>
              <div className="toolbar">
                <CameraButton disabled={photo.isPending || photos >= LIMITS.formPhotos} onFiles={(fl) => void sendPhotos(fl)} label="צילום / בחירת תמונה" />
              </div>
              <p aria-live="polite" className="muted">
                {photo.isPending ? 'מעלה…' : photos ? `צורפו ${photos} תמונות (נסרקות לאיתור נוזקות).` : ''}
              </p>
            </div>
          )}
          <div className="toolbar">
            <Link className="btn btn-primary" to="/forms">
              להדיווחים שלי
            </Link>
            <button type="button" className="btn" onClick={() => (setDone(null), setName(''), setValues({}), setPhotos(0))}>
              דיווח נוסף
            </button>
          </div>
        </div>
      </div>
    );

  return (
    <div className="form-page">
      <form className="card" onSubmit={onSubmit} noValidate>
        <p className="muted">{f.boardName}</p>
        <h1>{f.name}</h1>
        {f.description && <p className="form-desc">{f.description}</p>}
        <p className="hint">שדות המסומנים ב-* הם חובה. אין להזין מידע רפואי.</p>
        <div className="field">
          <label htmlFor="ff-name">
            {f.nameLabel} <span aria-hidden="true">*</span>
          </label>
          <input id="ff-name" className="input" required aria-required="true" maxLength={LIMITS.itemName} value={name} onChange={(e) => (setName(e.target.value), setError(null))} />
        </div>
        {f.fields.map((x) => {
          const label = x.label ?? x.column.title;
          const single = !['tags', 'person', 'rating', 'risk', 'date_range', 'checkbox'].includes(x.column.type);
          const fieldId = `ff-${x.columnId}`;
          return (
            <div className="field" key={x.columnId}>
              {single ? (
                <label htmlFor={fieldId}>
                  {label} {x.required && <span aria-hidden="true">*</span>}
                </label>
              ) : (
                <span className="label" id={`${fieldId}-l`}>
                  {label} {x.required && <span aria-hidden="true">*</span>}
                </span>
              )}
              <CellEditor
                id={fieldId}
                column={x.column}
                value={values[x.columnId]}
                users={f.members}
                assignable={f.members}
                readOnly={false}
                label={x.required ? `${label} (חובה)` : label}
                mode="drawer"
                onChange={(v) => (setValues((cur) => ({ ...cur, [x.columnId]: v })), setError(null))}
              />
              {x.help && <span className="hint">{x.help}</span>}
            </div>
          );
        })}
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <button type="submit" className="btn btn-primary" disabled={submit.isPending}>
          {submit.isPending ? 'שולח…' : 'שליחת הדיווח'}
        </button>
      </form>
    </div>
  );
}
