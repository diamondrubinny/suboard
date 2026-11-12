import {
  BOARD_ROLE_LABELS,
  BOARD_ROLES,
  COLOR_KEYS,
  COLUMN_TYPE_LABELS,
  COLUMN_TYPES,
  LIMITS,
  PALETTE,
  type BoardDetail,
  type BoardRole,
  type Column,
  type ColumnType,
  type StatusOption,
} from '@suboard/shared';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { useArchiveBoard, useDuplicateBoard, useModules, useBoard, useColumnMutations, useDirectory, useGroupMutations, useMemberMutations, useTemplateMutations, useTemplates, useUpdateBoard } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { usePageTitle } from '../../components/Layout';
import { colorStyle } from '../../components/StatusPill';
import { ChecklistSettingsEditor, ComplianceSection } from './FieldSettings';
import { FormulaEditor } from './FormulaEditor';
import { RelationSetup } from './RelationSetup';

export function BoardSettingsPage() {
  const { boardId = '' } = useParams();
  const board = useBoard(boardId);
  const modules = useModules();
  usePageTitle(`הגדרות — ${board.data?.name ?? 'לוח'}`);
  if (board.isPending) return <LoadingState />;
  if (board.isError) return <ErrorState message={errorMessage(board.error)} onRetry={() => board.refetch()} />;
  if (board.data.myRole !== 'owner') return <Navigate to={`/boards/${boardId}`} replace />;
  const b = board.data;
  return (
    <>
      <div className="page-header">
        <h1>הגדרות לוח: {b.name}</h1>
        <div className="actions">
          <Link to={`/boards/${b.id}`} className="btn">
            חזרה ללוח
          </Link>
        </div>
      </div>
      <div className="grid" style={{ gap: '1.25rem' }}>
        <GeneralSection board={b} />
        <ColumnsSection board={b} />
        <ComplianceSection board={b} />
        {modules.data?.forms !== false && (
        <section className="card" aria-labelledby="forms-h">
          <h2 id="forms-h">טפסים</h2>
          <p className="muted">טפסי דיווח שיוצרים פריטים בלוח — לחברי הלוח או לכל המשתמשים המחוברים (למשל דיווח כמעט-אירוע).</p>
          <Link to={`/boards/${b.id}/forms`} className="btn">
            ניהול טפסים
          </Link>
        </section>
        )}
        <GroupsSection board={b} />
        <MembersSection board={b} />
        <TemplateSection board={b} />
        <DuplicateSection board={b} />
        <DangerSection board={b} />
      </div>
    </>
  );
}

function GeneralSection({ board }: { board: BoardDetail }) {
  const update = useUpdateBoard(board.id);
  const { toast } = useFeedback();
  const [name, setName] = useState(board.name);
  const [description, setDescription] = useState(board.description);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast('שם הלוח הוא שדה חובה', 'error');
    update.mutate({ name: name.trim(), description }, { onSuccess: () => toast('הפרטים נשמרו'), onError: (err) => toast(errorMessage(err), 'error') });
  };
  return (
    <section className="card" aria-labelledby="gen-h">
      <h2 id="gen-h">פרטים כלליים</h2>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor="s-name">שם הלוח</label>
          <input id="s-name" className="input" value={name} maxLength={LIMITS.boardName} onChange={(e) => setName(e.target.value)} required />
        </div>
        <div className="field">
          <label htmlFor="s-desc">תיאור</label>
          <textarea id="s-desc" className="textarea" value={description} maxLength={LIMITS.boardDescription} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <button type="submit" className="btn btn-primary" disabled={update.isPending}>
          שמירה
        </button>
      </form>
    </section>
  );
}

function StatusOptionsEditor({ column, onSave, saving }: { column: Column; onSave: (options: StatusOption[]) => void; saving: boolean }) {
  const [options, setOptions] = useState<StatusOption[]>(column.settings.options ?? []);
  const set = (idx: number, patch: Partial<StatusOption>) => setOptions((o) => o.map((x, i) => (i === idx ? { ...x, ...patch } : x)));
  const add = () =>
    setOptions((o) => [...o, { id: `opt_${Math.random().toString(36).slice(2, 10)}`, label: 'תווית חדשה', color: COLOR_KEYS[o.length % COLOR_KEYS.length]! }]);
  const valid = (options.length > 0 || column.type === 'tags') && options.every((o) => o.label.trim());

  return (
    <fieldset style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-3)', marginTop: 'var(--space-2)' }}>
      <legend className="label">{column.type === 'tags' ? 'תגיות' : 'תוויות'} עבור "{column.title}"</legend>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">תווית</th>
            <th scope="col">צבע</th>
            {column.type === 'status' && <th scope="col">נחשב "סגור"</th>}
            <th scope="col">
              <span className="sr-only">פעולות</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {options.map((o, idx) => (
            <tr key={o.id}>
              <td>
                <input className="input" value={o.label} maxLength={LIMITS.statusLabel} aria-label={`שם התווית ${idx + 1}`} onChange={(e) => set(idx, { label: e.target.value })} />
              </td>
              <td>
                <select className="select" value={o.color} style={colorStyle(o.color)} aria-label={`צבע התווית ${o.label}`} onChange={(e) => set(idx, { color: e.target.value as StatusOption['color'] })}>
                  {COLOR_KEYS.map((k) => (
                    <option key={k} value={k}>
                      {PALETTE[k].label}
                    </option>
                  ))}
                </select>
              </td>
              {column.type === 'status' && (
              <td>
                <input type="checkbox" checked={Boolean(o.done)} aria-label={`התווית ${o.label} מסמנת פריט סגור`} onChange={(e) => set(idx, { done: e.target.checked || undefined })} />
              </td>
              )}
              <td>
                <button type="button" className="icon-btn" aria-label={`הסרת התווית ${o.label}`} onClick={() => setOptions((x) => x.filter((_, i) => i !== idx))} disabled={column.type === 'status' && options.length <= 1}>
                  <Icon name="trash" size={16} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint muted" style={{ fontSize: '0.85rem' }}>
        הסרת תווית תנקה אותה מכל הפריטים שבהם היא בשימוש. בעמודת הסטטוס הראשית, תוויות "סגור" קובעות אילו פריטים אינם נחשבים פתוחים או באיחור.
      </p>
      <div className="toolbar">
        <button type="button" className="btn btn-sm" onClick={add} disabled={options.length >= LIMITS.statusOptions}>
          <Icon name="plus" /> תווית
        </button>
        <button type="button" className="btn btn-primary btn-sm" disabled={!valid || saving} onClick={() => onSave(options.map((o) => ({ ...o, label: o.label.trim() })))}>
          שמירת תוויות
        </button>
      </div>
    </fieldset>
  );
}

function ColumnsSection({ board }: { board: BoardDetail }) {
  const { create, update, remove } = useColumnMutations(board.id);
  const { toast, confirm } = useFeedback();
  const [title, setTitle] = useState('');
  const [type, setType] = useState<ColumnType>('text');
  const [editing, setEditing] = useState<string | null>(null);
  const onErr = (e: unknown) => toast(errorMessage(e), 'error');

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return toast('יש להזין כותרת לעמודה', 'error');
    if (type === 'formula') return toast('יש לכתוב את הנוסחה למטה וללחוץ "הוספת עמודת נוסחה"', 'error');
    if (type === 'relation' || type === 'mirror') return toast('יש להשלים את הבחירה למטה', 'error');
    create.mutate({ title: title.trim(), type }, { onSuccess: () => (setTitle(''), toast('העמודה נוספה')), onError: onErr });
  };

  return (
    <section className="card" aria-labelledby="cols-h">
      <h2 id="cols-h">עמודות</h2>
      <ul className="list-plain item-list">
        {board.columns.map((c, idx) => (
          <li key={c.id} style={{ display: 'block' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
              <ColumnTitleInput column={c} onSave={(t) => update.mutate({ columnId: c.id, patch: { title: t } }, { onError: onErr })} />
              <span className="badge">{COLUMN_TYPE_LABELS[c.type]}</span>
              {c.settings.role === 'due' && <span className="badge success">תאריך יעד</span>}
              <span style={{ marginInlineStart: 'auto', display: 'flex', gap: '0.25rem' }}>
                <button type="button" className="icon-btn" aria-label={`הזזת ${c.title} למעלה`} disabled={idx === 0}
                  onClick={() => update.mutate({ columnId: c.id, patch: { position: (board.columns[idx - 1]!.position ?? 0) - 0.5 } }, { onError: onErr })}>
                  ▲
                </button>
                <button type="button" className="icon-btn" aria-label={`הזזת ${c.title} למטה`} disabled={idx === board.columns.length - 1}
                  onClick={() => update.mutate({ columnId: c.id, patch: { position: (board.columns[idx + 1]!.position ?? 0) + 0.5 } }, { onError: onErr })}>
                  ▼
                </button>
                {c.type === 'date' && c.settings.role !== 'due' && (
                  <button type="button" className="btn btn-sm" onClick={() => update.mutate({ columnId: c.id, patch: { settings: { role: 'due' } } }, { onError: onErr })}>
                    הגדר כתאריך יעד
                  </button>
                )}
                {(c.type === 'status' || c.type === 'tags') && (
                  <button type="button" className="btn btn-sm" aria-expanded={editing === c.id} onClick={() => setEditing(editing === c.id ? null : c.id)}>
                    {c.type === 'tags' ? 'עריכת תגיות' : 'עריכת תוויות'}
                  </button>
                )}
                {c.type === 'checklist' && (
                  <button type="button" className="btn btn-sm" aria-expanded={editing === c.id} onClick={() => setEditing(editing === c.id ? null : c.id)}>
                    עריכת סעיפים
                  </button>
                )}
                {c.type === 'formula' && (
                  <button type="button" className="btn btn-sm" aria-expanded={editing === c.id} onClick={() => setEditing(editing === c.id ? null : c.id)}>
                    עריכת הנוסחה
                  </button>
                )}
                {c.type === 'auto_id' && <PrefixInput column={c} onSave={(prefix) => update.mutate({ columnId: c.id, patch: { settings: { prefix } } }, { onError: onErr })} />}
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`מחיקת העמודה ${c.title}`}
                  onClick={async () => {
                    if (await confirm({ title: 'מחיקת עמודה', message: `למחוק את העמודה "${c.title}"? כל הערכים בעמודה יימחקו לצמיתות.`, confirmLabel: 'מחיקה', danger: true })) {
                      remove.mutate(c.id, { onSuccess: () => toast('העמודה נמחקה'), onError: onErr });
                    }
                  }}
                >
                  <Icon name="trash" size={16} />
                </button>
              </span>
            </div>
            {editing === c.id && c.type === 'checklist' && (
              <ChecklistSettingsEditor
                board={board}
                column={c}
                saving={update.isPending}
                onSave={(checklist) =>
                  update.mutate({ columnId: c.id, patch: { settings: { checklist } } }, { onSuccess: () => (setEditing(null), toast('הצ\'קליסט נשמר')), onError: onErr })
                }
              />
            )}
            {editing === c.id && c.type === 'formula' && (
              <FormulaEditor
                column={c}
                columns={board.columns}
                saving={update.isPending}
                onSave={(formula) => update.mutate({ columnId: c.id, patch: { settings: { formula } } }, { onSuccess: () => (setEditing(null), toast('הנוסחה נשמרה')), onError: onErr })}
              />
            )}
            {editing === c.id && c.type !== 'checklist' && c.type !== 'formula' && (
              <StatusOptionsEditor
                column={c}
                saving={update.isPending}
                onSave={(options) =>
                  update.mutate(
                    { columnId: c.id, patch: { settings: { options } } },
                    { onSuccess: () => (setEditing(null), toast('התוויות נשמרו')), onError: onErr },
                  )
                }
              />
            )}
          </li>
        ))}
      </ul>
      <form onSubmit={add} className="toolbar" style={{ marginTop: '1rem' }}>
        <label htmlFor="new-col-title" className="sr-only">
          כותרת עמודה חדשה
        </label>
        <input id="new-col-title" className="input" placeholder="כותרת עמודה חדשה" value={title} maxLength={LIMITS.columnTitle} onChange={(e) => setTitle(e.target.value)} />
        <label htmlFor="new-col-type" className="sr-only">
          סוג עמודה
        </label>
        <select id="new-col-type" className="select" value={type} onChange={(e) => setType(e.target.value as ColumnType)}>
          {COLUMN_TYPES.map((t) => (
            <option key={t} value={t}>
              {COLUMN_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
        {type !== 'formula' && type !== 'relation' && type !== 'mirror' && (
          <button type="submit" className="btn" disabled={create.isPending}>
            <Icon name="plus" /> הוספת עמודה
          </button>
        )}
      </form>
      {(type === 'relation' || type === 'mirror') && (
        <RelationSetup
          kind={type}
          board={board}
          saving={create.isPending}
          onSave={(settings) => {
            if (!title.trim()) return toast('יש להזין כותרת לעמודה', 'error');
            create.mutate({ title: title.trim(), type, settings }, { onSuccess: () => (setTitle(''), setType('text'), toast('העמודה נוספה')), onError: onErr });
          }}
        />
      )}
      {type === 'formula' && (
        <FormulaEditor
          columns={board.columns}
          saving={create.isPending}
          onSave={(formula) => {
            if (!title.trim()) return toast('יש להזין כותרת לעמודה', 'error');
            create.mutate({ title: title.trim(), type: 'formula', settings: { formula } }, { onSuccess: () => (setTitle(''), setType('text'), toast('עמודת הנוסחה נוספה')), onError: onErr });
          }}
        />
      )}
    </section>
  );
}

function PrefixInput({ column, onSave }: { column: Column; onSave: (prefix: string) => void }) {
  const [draft, setDraft] = useState(column.settings.prefix ?? '');
  return (
    <input
      className="input"
      style={{ inlineSize: '7rem' }}
      dir="ltr"
      value={draft}
      maxLength={10}
      placeholder="INC"
      aria-label={`תחילית למזהה בעמודה ${column.title}`}
      onChange={(e) => setDraft(e.target.value.replace(/[^A-Za-z0-9]/g, ''))}
      onBlur={() => draft !== (column.settings.prefix ?? '') && onSave(draft)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function ColumnTitleInput({ column, onSave }: { column: Column; onSave: (t: string) => void }) {
  const [draft, setDraft] = useState(column.title);
  return (
    <input
      className="cell-input"
      style={{ maxInlineSize: '18rem', fontWeight: 600 }}
      value={draft}
      maxLength={LIMITS.columnTitle}
      aria-label={`כותרת העמודה ${column.title}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const t = draft.trim();
        if (!t) return setDraft(column.title);
        if (t !== column.title) onSave(t);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}

function GroupsSection({ board }: { board: BoardDetail }) {
  const { remove, update, duplicate } = useGroupMutations(board.id);
  const { toast, confirm } = useFeedback();
  return (
    <section className="card" aria-labelledby="groups-h">
      <h2 id="groups-h">קבוצות</h2>
      <p className="muted">שינוי שם קבוצה והוספת קבוצות מתבצעים ישירות בתצוגת הטבלה.</p>
      <ul className="list-plain item-list">
        {board.groups.map((g) => {
          const count = board.items.filter((i) => i.groupId === g.id).length;
          return (
            <li key={g.id}>
              <span className="group-color" style={{ background: PALETTE[g.color]?.bg }} aria-hidden="true" />
              <span className="grow">
                {g.name} <span className="muted">({count} פריטים)</span>
              </span>
              <label className="sr-only" htmlFor={`gc-${g.id}`}>
                צבע הקבוצה {g.name}
              </label>
              <select id={`gc-${g.id}`} className="select" style={{ inlineSize: 'auto' }} value={g.color}
                onChange={(e) => update.mutate({ groupId: g.id, patch: { color: e.target.value } }, { onError: (err) => toast(errorMessage(err), 'error') })}>
                {COLOR_KEYS.map((k) => (
                  <option key={k} value={k}>
                    {PALETTE[k].label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="btn btn-sm"
                aria-label={`שכפול הקבוצה ${g.name}`}
                disabled={duplicate.isPending}
                onClick={() => duplicate.mutate(g.id, { onSuccess: (r) => toast(`הקבוצה שוכפלה (${r.items} פריטים)`), onError: (err) => toast(errorMessage(err), 'error') })}
              >
                שכפול
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`מחיקת הקבוצה ${g.name}`}
                disabled={board.groups.length <= 1}
                onClick={async () => {
                  const ok = await confirm({
                    title: 'מחיקת קבוצה',
                    message: count ? `למחוק את הקבוצה "${g.name}" ואת ${count} הפריטים שבה? הפעולה אינה ניתנת לביטול.` : `למחוק את הקבוצה "${g.name}"?`,
                    confirmLabel: 'מחיקה',
                    danger: true,
                  });
                  if (ok) remove.mutate(g.id, { onSuccess: () => toast('הקבוצה נמחקה'), onError: (err) => toast(errorMessage(err), 'error') });
                }}
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function MembersSection({ board }: { board: BoardDetail }) {
  const { user } = useAuth();
  const directory = useDirectory();
  const { set, remove } = useMemberMutations(board.id);
  const { toast, confirm } = useFeedback();
  const [userId, setUserId] = useState('');
  const [role, setRole] = useState<BoardRole>('editor');
  const onErr = (e: unknown) => toast(errorMessage(e), 'error');
  const candidates = (directory.data ?? []).filter((u) => !board.members.some((m) => m.userId === u.id));

  return (
    <section className="card" aria-labelledby="members-h">
      <h2 id="members-h">חברים והרשאות</h2>
      <p className="muted">
        <strong>בעלים</strong> — ניהול מלא כולל עמודות וחברים · <strong>עורך</strong> — הוספה ועריכה של פריטים ועדכונים · <strong>צופה</strong> — קריאה בלבד.
        מנהלי מערכת רואים את כל הלוחות.
      </p>
      {/* Scrolls sideways on narrow screens instead of widening the page. */}
      <div className="table-wrap" tabIndex={0} role="region" aria-label="חברי הלוח">
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">שם</th>
              <th scope="col">דוא"ל</th>
              <th scope="col">הרשאה</th>
              <th scope="col">
                <span className="sr-only">פעולות</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {board.members.map((m) => (
              <tr key={m.userId}>
                <td>{m.name}</td>
                <td dir="ltr" style={{ textAlign: 'end' }}>
                  {m.email}
                </td>
                <td>
                  <select className="select" value={m.role} aria-label={`הרשאה עבור ${m.name}`}
                    onChange={(e) => set.mutate({ userId: m.userId, role: e.target.value as BoardRole }, { onSuccess: () => toast('ההרשאה עודכנה'), onError: onErr })}>
                    {BOARD_ROLES.map((r) => (
                      <option key={r} value={r}>
                        {BOARD_ROLE_LABELS[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    type="button"
                    className="icon-btn"
                    aria-label={`הסרת ${m.name} מהלוח`}
                    onClick={async () => {
                      const self = m.userId === user?.id;
                      if (await confirm({ title: 'הסרת חבר', message: self ? 'להסיר את עצמך מהלוח? ייתכן שתאבד/י גישה אליו.' : `להסיר את ${m.name} מהלוח?`, confirmLabel: 'הסרה', danger: true })) {
                        remove.mutate(m.userId, { onSuccess: () => toast('החבר הוסר'), onError: onErr });
                      }
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form
        className="toolbar"
        style={{ marginTop: '1rem' }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!userId) return toast('יש לבחור משתמש', 'error');
          set.mutate({ userId, role }, { onSuccess: () => (setUserId(''), toast('החבר נוסף')), onError: onErr });
        }}
      >
        <label htmlFor="add-member" className="sr-only">
          משתמש להוספה
        </label>
        <select id="add-member" className="select" value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">בחירת משתמש…</option>
          {candidates.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
        <label htmlFor="add-role" className="sr-only">
          הרשאה
        </label>
        <select id="add-role" className="select" value={role} onChange={(e) => setRole(e.target.value as BoardRole)}>
          {BOARD_ROLES.map((r) => (
            <option key={r} value={r}>
              {BOARD_ROLE_LABELS[r]}
            </option>
          ))}
        </select>
        <button type="submit" className="btn" disabled={set.isPending}>
          <Icon name="plus" /> הוספה
        </button>
      </form>
    </section>
  );
}

/** Save this board's structure as an organisation template; manage the templates you may delete. */
function DuplicateSection({ board }: { board: BoardDetail }) {
  const { user } = useAuth();
  const dup = useDuplicateBoard(board.id);
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const [name, setName] = useState(`${board.name} (עותק)`.slice(0, LIMITS.boardName));
  const [withItems, setWithItems] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (user?.role === 'member') return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('יש להזין שם ללוח החדש');
    setError(null);
    dup.mutate(
      { name: name.trim(), withItems },
      {
        onSuccess: (r) => {
          toast(withItems ? `הלוח שוכפל עם ${r.items} פריטים` : 'הלוח שוכפל');
          navigate(`/boards/${r.board.id}`);
        },
        onError: (err) => setError(errorMessage(err)),
      },
    );
  };
  return (
    <section className="card" aria-labelledby="dup-h">
      <h2 id="dup-h">שכפול הלוח</h2>
      <p className="muted">לוח חדש עם אותן קבוצות ועמודות (כולל נוסחאות). חברים, אוטומציות, טפסים, עדכונים וקבצים אינם מועתקים; בלוח החדש רק את/ה חבר/ה.</p>
      <form onSubmit={submit} noValidate>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor="dup-name">שם הלוח החדש</label>
          <input id="dup-name" className="input" value={name} maxLength={LIMITS.boardName} onChange={(e) => setName(e.target.value)} />
        </div>
        <label className="check">
          <input type="checkbox" checked={withItems} onChange={(e) => setWithItems(e.target.checked)} /> להעתיק גם את הפריטים ({board.items.length}) — בלי שיוך לאנשים ובלי תוצאות צ׳קליסט
        </label>
        <p>
          <button type="submit" className="btn" disabled={dup.isPending} aria-busy={dup.isPending}>
            {dup.isPending ? 'משכפל…' : 'שכפול הלוח'}
          </button>
        </p>
      </form>
    </section>
  );
}

function TemplateSection({ board }: { board: BoardDetail }) {
  const { user } = useAuth();
  const templates = useTemplates();
  const { save, remove } = useTemplateMutations();
  const { toast, confirm } = useFeedback();
  const [name, setName] = useState(`${board.name} — תבנית`.slice(0, LIMITS.boardName));
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);
  if (user?.role !== 'admin' && user?.role !== 'manager') return null;
  const mine = (templates.data?.custom ?? []).filter((t) => user.role === 'admin' || t.createdBy === user.id);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return setError('יש לתת שם לתבנית');
    setError(null);
    save.mutate(
      { boardId: board.id, name: name.trim(), description: description.trim() || undefined },
      { onSuccess: (t) => toast(`התבנית "${t.name}" נשמרה. היא תופיע בחלון "לוח חדש".`), onError: (err) => setError(errorMessage(err)) },
    );
  };

  return (
    <section className="card" aria-labelledby="tpl-h">
      <h2 id="tpl-h">שמירה כתבנית</h2>
      <p className="muted">
        נשמר <strong>המבנה בלבד</strong>: קבוצות ועמודות עם ההגדרות שלהן. פריטים, חברים, קבצים, עדכונים ואוטומציות אינם נשמרים, וגם לא קישור לצ׳קליסט ללוח פעולות מתקנות. התבנית תהיה זמינה לכל המנהלים ביצירת לוח חדש.
      </p>
      <form onSubmit={submit} noValidate>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <div className="field">
          <label htmlFor="tpl-name">שם התבנית</label>
          <input id="tpl-name" className="input" value={name} maxLength={LIMITS.boardName} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="tpl-desc">תיאור (אופציונלי)</label>
          <textarea id="tpl-desc" className="textarea" rows={2} value={description} maxLength={LIMITS.boardDescription} onChange={(e) => setDescription(e.target.value)} aria-describedby="tpl-desc-hint" />
          <span id="tpl-desc-hint" className="hint">
            אין לכלול שמות אנשים או מידע אישי — התבנית גלויה לכל המנהלים.
          </span>
        </div>
        <button type="submit" className="btn btn-primary" disabled={save.isPending}>
          {save.isPending ? 'שומר…' : 'שמירה כתבנית'}
        </button>
      </form>
      {mine.length > 0 && (
        <>
          <h3 id="tpl-mine-h" style={{ marginBlock: 'var(--space-4) var(--space-2)' }}>
            {user.role === 'admin' ? 'תבניות הארגון' : 'תבניות ששמרת'}
          </h3>
          <ul className="list-plain" aria-labelledby="tpl-mine-h">
            {mine.map((t) => (
              <li key={t.id} className="tpl-row">
                <span style={{ flex: 1 }}>
                  <strong>{t.name}</strong>
                  <br />
                  <small className="muted">
                    {t.groupCount} קבוצות, {t.columnCount} עמודות{t.createdByName ? ` · ${t.createdByName}` : ''}
                  </small>
                </span>
                <button
                  type="button"
                  className="btn btn-sm"
                  aria-label={`מחיקת התבנית ${t.name}`}
                  disabled={remove.isPending}
                  onClick={async () => {
                    if (!(await confirm({ title: 'מחיקת תבנית', message: `למחוק את התבנית "${t.name}"? לוחות שכבר נוצרו ממנה לא ישתנו.`, confirmLabel: 'מחיקה', danger: true }))) return;
                    remove.mutate(t.id, { onSuccess: () => toast('התבנית נמחקה'), onError: (e) => toast(errorMessage(e), 'error') });
                  }}
                >
                  <Icon name="trash" size={16} /> מחיקה
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

function DangerSection({ board }: { board: BoardDetail }) {
  const archive = useArchiveBoard(board.id);
  const { confirm, toast } = useFeedback();
  const navigate = useNavigate();
  return (
    <section className="card danger-zone" aria-labelledby="danger-h">
      <h2 id="danger-h">העברה לארכיון</h2>
      <p>הלוח יוסתר מכל המשתמשים. הנתונים נשמרים במסד הנתונים וניתנים לשחזור על ידי מנהל מערכת בלבד.</p>
      <button
        type="button"
        className="btn btn-danger"
        disabled={archive.isPending}
        onClick={async () => {
          if (await confirm({ title: 'העברת לוח לארכיון', message: `להעביר את "${board.name}" לארכיון? הלוח לא יהיה זמין יותר למשתמשים.`, confirmLabel: 'העברה לארכיון', danger: true })) {
            archive.mutate(undefined, { onSuccess: () => (toast('הלוח הועבר לארכיון'), navigate('/boards')), onError: (e) => toast(errorMessage(e), 'error') });
          }
        }}
      >
        העברה לארכיון
      </button>
    </section>
  );
}
