import { apiUrl, appLink } from '../../api/base';
import {
  createFormSchema,
  visibleFormFields,
  findPrimaryStatusColumn,
  QUESTION_TYPE_LABELS,
  QUESTION_TYPES,
  type QuestionType,
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
import { useEffect, useId, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client';
import { useAvailableForms, useManagedFormActions, useManagedForms, useBoard, useBoardForms, useColumnMutations, useFormForFill, useFormMutations, useMySubmissions, useSubmitForm } from '../../api/hooks';
import { CameraButton } from '../../components/CameraButton';
import { CellEditor } from '../../components/cells/CellEditor';
import { Dialog } from '../../components/Dialog';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { usePageTitle } from '../../components/Layout';
import { StatusPill } from '../../components/StatusPill';
import { useAuth } from '../../auth/AuthContext';
import { ShareFormDialog } from './ShareFormDialog';

/** Question kinds that need no options editor (choice questions are edited in the board's column settings). */
const SIMPLE_QUESTIONS: QuestionType[] = ['text', 'long_text', 'number', 'date', 'yes_no', 'rating', 'email', 'phone', 'link'];

/** On/off switch that reflects the click at once (no flicker while the change is saved). */
function FormSwitch({ name, enabled, onToggle }: { name: string; enabled: boolean; onToggle: (on: boolean) => void }) {
  const [local, setLocal] = useState<boolean | null>(null);
  useEffect(() => setLocal(null), [enabled]);
  useEffect(() => {
    if (local === null) return;
    const t = window.setTimeout(() => setLocal(null), 4000); // a failed save falls back to the stored state
    return () => window.clearTimeout(t);
  }, [local]);
  const on = local ?? enabled;
  return (
    <>
      <input
        type="checkbox"
        role="switch"
        checked={on}
        aria-label={`הטופס "${name}" פעיל`}
        onChange={(e) => {
          setLocal(e.target.checked);
          onToggle(e.target.checked);
        }}
      />
      <span aria-hidden="true">{on ? 'פעיל' : 'כבוי'}</span>
    </>
  );
}

// ---------------------------------------------------------------- management
export function FormsAdminPage() {
  const { boardId = '' } = useParams();
  const board = useBoard(boardId);
  const forms = useBoardForms(boardId);
  const { update, remove } = useFormMutations(boardId);
  const { toast, confirm } = useFeedback();
  const [editing, setEditing] = useState<BoardForm | 'new' | null>(null);
  const [sharing, setSharing] = useState<{ form: BoardForm; created: boolean } | null>(null);
  const { create } = useFormMutations(boardId);
  const [params, setParams] = useSearchParams();
  const editParam = params.get('edit');
  useEffect(() => {
    const f = editParam && forms.data?.find((x) => x.id === editParam);
    if (f) {
      setEditing(f);
      setParams((p) => (p.delete('edit'), p), { replace: true });
    }
  }, [editParam, forms.data, setParams]);
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
  const link = (f: BoardForm) => appLink(`/forms/${f.id}`);

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
          <button
            type="button"
            className="btn btn-primary"
            disabled={create.isPending}
            title="טופס עם כל השדות המתאימים בלוח, פתוח לכל המשתמשים המחוברים — מוכן לשיתוף מיד"
            onClick={() => {
              const fields = b.columns.filter((c) => (FORM_FIELD_TYPES as readonly string[]).includes(c.type) && c.id !== findPrimaryStatusColumn(b.columns)?.id).slice(0, LIMITS.formFields);
              create.mutate(
                { name: `דיווח — ${b.name}`.slice(0, 80), description: '', groupId: b.groups[0]!.id, nameLabel: 'נושא', fields: fields.map((c) => ({ columnId: c.id, required: false })), audience: 'all_users', allowPhotos: true, enabled: true },
                { onSuccess: (form) => setSharing({ form, created: true }), onError: (err) => toast(errorMessage(err), 'error') },
              );
            }}
          >
            <Icon name="bolt" /> טופס בקליק
          </button>
          <button type="button" className="btn" onClick={() => setEditing('new')}>
            <Icon name="plus" /> טופס מותאם
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
                <FormSwitch name={f.name} enabled={f.enabled} onToggle={(on) => update.mutate({ id: f.id, patch: { enabled: on } }, { onError: (err) => toast(errorMessage(err), 'error') })} />
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
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setSharing({ form: f, created: false })}>
                שיתוף וקוד QR<span className="sr-only"> של {f.name}</span>
              </button>
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
      <ShareFormDialog form={sharing?.form ?? null} created={sharing?.created} onClose={() => setSharing(null)}>
        {sharing?.created && (
          <button type="button" className="btn" onClick={() => (setEditing(sharing.form), setSharing(null))}>
            עריכת השדות
          </button>
        )}
      </ShareFormDialog>
    </>
  );
}

/** "Show only if": pick an earlier choice / yes-no question of the form and the answers that reveal this one. */
function ShowIfEditor({ board, fields, field, title, onChange }: { board: BoardDetail; fields: FormField[]; field: FormField; title: string; onChange: (v: FormField['showIf']) => void }) {
  const idx = fields.findIndex((f) => f.columnId === field.columnId);
  const candidates = fields
    .slice(0, idx)
    .map((f) => board.columns.find((c) => c.id === f.columnId))
    .filter((c): c is BoardDetail['columns'][number] => Boolean(c) && ['status', 'tags', 'checkbox'].includes(c!.type));
  const ctrl = candidates.find((c) => c.id === field.showIf?.columnId);
  const options = ctrl ? (ctrl.type === 'checkbox' ? [{ id: 'true', label: 'כן' }, { id: 'false', label: 'לא' }] : (ctrl.settings.options ?? []).map((o) => ({ id: o.id, label: o.label }))) : [];
  if (!candidates.length) return <p className="hint">תנאי תצוגה: אפשרי כשיש לפני השאלה הזו שאלת בחירה או כן/לא בטופס.</p>;
  return (
    <div className="rule-row show-if">
      <select
        className="select"
        aria-label={`הצגת ${title} רק אם — שאלה`}
        value={field.showIf?.columnId ?? ''}
        onChange={(e) => {
          const c = candidates.find((x) => x.id === e.target.value);
          if (!c) return onChange(undefined);
          const first = c.type === 'checkbox' ? 'true' : c.settings.options?.[0]?.id;
          onChange(first ? { columnId: c.id, optionIds: [first] } : undefined);
        }}
      >
        <option value="">תמיד מוצגת</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            רק אם "{c.title}" הוא…
          </option>
        ))}
      </select>
      {ctrl && (
        <span className="check-list" role="group" aria-label={`תשובות שמציגות את ${title}`}>
          {options.map((o) => {
            const on = field.showIf!.optionIds.includes(o.id);
            return (
              <label key={o.id} className="check">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) => {
                    const next = e.target.checked ? [...field.showIf!.optionIds, o.id] : field.showIf!.optionIds.filter((x) => x !== o.id);
                    onChange(next.length ? { columnId: ctrl.id, optionIds: next } : undefined);
                  }}
                />{' '}
                {o.label}
              </label>
            );
          })}
        </span>
      )}
    </div>
  );
}

function MemberChecks({ legend, board, value, onChange, disabled = false }: { legend: string; board: BoardDetail; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  return (
    <fieldset className="check-list" disabled={disabled}>
      <legend className="label">{legend}</legend>
      {board.members.map((mb) => (
        <label key={mb.userId} className="check">
          <input type="checkbox" checked={value.includes(mb.userId)} onChange={(e) => onChange(e.target.checked ? [...value, mb.userId] : value.filter((x) => x !== mb.userId))} /> {mb.name}
        </label>
      ))}
    </fieldset>
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
  const [successMessage, setSuccessMessage] = useState(form?.successMessage ?? '');
  const [notifyUserIds, setNotifyUserIds] = useState<string[]>(form?.notifyUserIds ?? []);
  const [assignUserIds, setAssignUserIds] = useState<string[]>(form?.assignUserIds ?? []);
  const [fields, setFields] = useState<FormField[]>(form?.fields ?? []);
  const [error, setError] = useState<string | null>(null);
  const columns = useColumnMutations(board.id);
  const [newQ, setNewQ] = useState<{ title: string; type: QuestionType }>({ title: '', type: 'text' });
  const ids = { n: useId(), d: useId(), g: useId(), nl: useId(), sm: useId() };
  const allowed: readonly ColumnType[] = audience === 'all_users' ? FORM_FIELD_TYPES : MEMBER_FORM_FIELD_TYPES;
  const pending = create.isPending || update.isPending;

  const toggle = (columnId: string, on: boolean) =>
    setFields(on ? [...fields, { columnId, required: false }] : fields.filter((f) => f.columnId !== columnId).map((f) => (f.showIf?.columnId === columnId ? { ...f, showIf: undefined } : f)));
  const patchField = (columnId: string, patch: Partial<FormField>) => setFields(fields.map((f) => (f.columnId === columnId ? { ...f, ...patch } : f)));

  const save = () => {
    setError(null);
    const parsed = createFormSchema.safeParse({ name, description, groupId, nameLabel, audience, allowPhotos, successMessage, notifyUserIds, assignUserIds, fields: fields.filter((f) => allowed.includes(board.columns.find((c) => c.id === f.columnId)?.type as ColumnType)), enabled: form?.enabled ?? true });
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
          <div className="toolbar">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFields(board.columns.filter((c) => allowed.includes(c.type)).map((c) => fields.find((f) => f.columnId === c.id) ?? { columnId: c.id, required: false }))}>
              בחירת כל השדות
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setFields([])} disabled={fields.length === 0}>
              ניקוי
            </button>
          </div>
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
                {f && ok && (
                  <details className="field-advanced">
                    <summary>התאמה: כותרת מקטע ותנאי תצוגה{f.section || f.showIf ? ' ●' : ''}</summary>
                    <div className="rule-row">
                      <input className="input" aria-label={`כותרת מקטע לפני ${c.title}`} placeholder="כותרת מקטע לפני השאלה (לא חובה)" maxLength={80} value={f.section ?? ''} onChange={(e) => patchField(c.id, { section: e.target.value || undefined })} />
                    </div>
                    <ShowIfEditor board={board} fields={fields} field={f} title={c.title} onChange={(showIf) => patchField(c.id, { showIf })} />
                  </details>
                )}
              </div>
            );
          })}
        </fieldset>
        <form
          className="new-question"
          onSubmit={(e) => {
            e.preventDefault();
            const title = newQ.title.trim();
            if (!title) return;
            columns.create.mutate(
              { title, type: QUESTION_TYPES[newQ.type] },
              { onSuccess: (col) => (setFields((f) => [...f, { columnId: col.id, required: false }]), setNewQ({ title: '', type: 'text' }), toast(`השאלה "${title}" נוספה לטופס וכעמודה בלוח`)), onError: (err) => setError(errorMessage(err)) },
            );
          }}
        >
          <div className="field grow">
            <label htmlFor="nq-title">שאלה חדשה (תיווצר גם עמודה בלוח)</label>
            <input id="nq-title" className="input" maxLength={LIMITS.columnTitle} value={newQ.title} onChange={(e) => setNewQ({ ...newQ, title: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="nq-type">סוג תשובה</label>
            <select id="nq-type" className="select" value={newQ.type} onChange={(e) => setNewQ({ ...newQ, type: e.target.value as QuestionType })}>
              {SIMPLE_QUESTIONS.map((t) => (
                <option key={t} value={t}>
                  {QUESTION_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn" disabled={!newQ.title.trim() || columns.create.isPending}>
            <Icon name="plus" size={16} /> הוספת שאלה
          </button>
        </form>
        <label className="check">
          <input type="checkbox" checked={allowPhotos} onChange={(e) => setAllowPhotos(e.target.checked)} /> לאפשר צירוף עד {LIMITS.formPhotos} תמונות (נסרקות לאיתור נוזקות)
        </label>
        <div className="field">
          <label htmlFor={ids.sm}>הודעה אחרי שליחה (לא חובה)</label>
          <input id={ids.sm} className="input" maxLength={500} value={successMessage} onChange={(e) => setSuccessMessage(e.target.value)} placeholder="למשל: תודה! נחזור אליך תוך שני ימי עבודה." />
        </div>
        <fieldset className="rule-block">
          <legend>
            <span className="rule-kw">חיבור לתהליך העבודה</span>
          </legend>
          <p className="hint">רק חברי הלוח. מי שיוסר מהלוח יפסיק לקבל התראות ושיוכים.</p>
          <div className="rule-row">
            <MemberChecks legend="התראה על כל תשובה חדשה" board={board} value={notifyUserIds} onChange={setNotifyUserIds} />
            <MemberChecks legend="שיוך אוטומטי של כל תשובה ל-" board={board} value={assignUserIds} onChange={setAssignUserIds} disabled={!board.columns.some((c) => c.type === 'person')} />
          </div>
          {!board.columns.some((c) => c.type === 'person') && <p className="hint">לשיוך אוטומטי נדרשת עמודת "אנשים" בלוח.</p>}
        </fieldset>
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
/** Management hub: every form on a board I own — responses, on/off, share, edit, duplicate, export. */
function ManagedForms() {
  const q = useManagedForms();
  const { toggle, duplicate, remove } = useManagedFormActions();
  const { toast, confirm } = useFeedback();
  const [sharing, setSharing] = useState<BoardForm | null>(null);
  const onErr = (e: unknown) => toast(errorMessage(e), 'error');
  if (!q.data || q.data.length === 0) return null;
  return (
    <section aria-labelledby="forms-managed" className="card">
      <h2 id="forms-managed">
        הטפסים שאני מנהל/ת <span className="badge">{q.data.length}</span>
      </h2>
      <ul className="list-plain managed-forms">
        {q.data.map((f) => (
          <li key={f.id} className={f.enabled ? 'managed-form' : 'managed-form disabled'}>
            <div className="managed-form-head">
              <div>
                <h3>{f.name}</h3>
                <p className="muted">
                  לוח: {f.boardName} · {f.submissions} תשובות · {f.audience === 'all_users' ? 'לכל המשתמשים' : 'לחברי הלוח'}
                  {f.assignUserIds.length > 0 && ' · שיוך אוטומטי'}
                  {f.notifyUserIds.length > 0 && ' · התראה'}
                </p>
              </div>
              <label className="switch">
                <FormSwitch name={f.name} enabled={f.enabled} onToggle={(on) => toggle.mutate({ id: f.id, enabled: on }, { onError: onErr })} />
              </label>
            </div>
            <div className="actions">
              <button type="button" className="btn btn-sm btn-primary" onClick={() => setSharing(f)}>
                שיתוף וקוד QR<span className="sr-only"> של {f.name}</span>
              </button>
              <Link className="btn btn-sm" to={`/boards/${f.boardId}/forms?edit=${f.id}`}>
                עריכה<span className="sr-only"> של {f.name}</span>
              </Link>
              <button type="button" className="btn btn-sm" disabled={duplicate.isPending} onClick={() => duplicate.mutate(f.id, { onSuccess: (c) => toast(`נוצר "${c.name}" (כבוי עד שתפעילו אותו)`), onError: onErr })}>
                שכפול<span className="sr-only"> של {f.name}</span>
              </button>
              <Link className="btn btn-sm" to={`/boards/${f.boardId}`}>
                תשובות<span className="sr-only"> של {f.name} (לוח {f.boardName})</span>
              </Link>
              <a className="btn btn-sm btn-ghost" href={apiUrl(`/boards/${f.boardId}/export.xlsx`)} download>
                <Icon name="download" size={16} /> Excel<span className="sr-only"> — תשובות {f.name}</span>
              </a>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={async () => {
                  if (await confirm({ title: 'מחיקת טופס', message: `למחוק את הטופס "${f.name}"? התשובות שכבר התקבלו יישארו בלוח.`, confirmLabel: 'מחיקה', danger: true })) remove.mutate(f.id, { onSuccess: () => toast('הטופס נמחק'), onError: onErr });
                }}
              >
                מחיקה<span className="sr-only"> של {f.name}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>
      <ShareFormDialog form={sharing} onClose={() => setSharing(null)} />
    </section>
  );
}

export function FormsPage() {
  usePageTitle('טפסים ודיווחים');
  const { user } = useAuth();
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
        {user && user.role !== 'member' && (
          <div className="actions">
            <Link to="/forms/new" className="btn btn-primary">
              <Icon name="plus" /> טופס חדש
            </Link>
          </div>
        )}
      </div>
      <ManagedForms />
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
    const shown = visibleFormFields(f.fields, values);
    const missing = f.fields.find((x) => x.required && shown.has(x.columnId) && (values[x.columnId] === undefined || values[x.columnId] === null));
    if (missing) return setError(`השדה "${missing.label ?? missing.column.title}" הוא חובה`);
    const clean = Object.fromEntries(Object.entries(values).filter(([k, v]) => v !== null && v !== undefined && shown.has(k)));
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
            מספר אסמכתא: <strong className="num">{done.ref}</strong>. {f.successMessage || 'יחידת הבטיחות תטפל בו; אפשר לעקוב אחרי הסטטוס ב"הדיווחים שלי".'}
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
          <input id="ff-name" className="input" required aria-required="true" maxLength={LIMITS.itemName} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {f.fields.map((x) => {
          // Conditional questions appear only when their condition holds (announced politely when they do).
          if (!visibleFormFields(f.fields, values).has(x.columnId)) return null;
          const label = x.label ?? x.column.title;
          const single = !['tags', 'person', 'rating', 'risk', 'date_range', 'checkbox'].includes(x.column.type);
          const fieldId = `ff-${x.columnId}`;
          return (
            <div className="field" key={x.columnId} aria-live={x.showIf ? 'polite' : undefined}>
              {x.section && <h2 className="form-section">{x.section}</h2>}
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
                onChange={(v) => setValues((cur) => ({ ...cur, [x.columnId]: v }))}
              />
              {x.help && <span className="hint">{x.help}</span>}
            </div>
          );
        })}
        {/* Kept until the next submit: clearing it on edit shifted the button under the pointer mid-click. */}
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
