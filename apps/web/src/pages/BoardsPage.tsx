import { BOARD_ROLE_LABELS, createBoardSchema } from '@suboard/shared';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useBoards, useCreateBoard, useTemplates, useWorkspaceMutations, useWorkspaces } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { Dialog } from '../components/Dialog';
import { EmptyState, ErrorState, LoadingState, useFeedback } from '../components/Feedback';
import { Icon, type IconName } from '../components/Icon';
import { usePageTitle } from '../components/Layout';
import { FavoriteButton } from '../components/FavoriteButton';

function CreateBoardDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const templates = useTemplates();
  const create = useCreateBoard();
  const navigate = useNavigate();
  const { toast } = useFeedback();
  const [templateKey, setTemplateKey] = useState('incidents');
  /** Set when an organisation template is chosen (takes precedence over templateKey). */
  const [customId, setCustomId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [workspaceId, setWorkspaceId] = useState('');
  const workspaces = useWorkspaces();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const nameRef = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = createBoardSchema.safeParse({ name, description, templateKey });
    if (!parsed.success) {
      const fe: Record<string, string> = {};
      for (const i of parsed.error.issues) fe[String(i.path[0])] ??= i.message;
      setErrors(fe);
      nameRef.current?.focus();
      return;
    }
    try {
      const board = await create.mutateAsync({ ...parsed.data, ...(customId ? { customTemplateId: customId } : {}), ...(workspaceId ? { workspaceId } : {}) });
      toast(`הלוח "${board.name}" נוצר`);
      onClose();
      navigate(`/boards/${board.id}`);
    } catch (err) {
      setErrors({ _: errorMessage(err) });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="לוח חדש"
      initialFocusRef={nameRef}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            ביטול
          </button>
          <button type="submit" form="create-board" className="btn btn-primary" disabled={create.isPending}>
            {create.isPending ? 'יוצר…' : 'יצירת לוח'}
          </button>
        </>
      }
    >
      <form id="create-board" onSubmit={submit} noValidate>
        {errors._ && (
          <div className="form-error" role="alert">
            {errors._}
          </div>
        )}
        <div className="field">
          <label htmlFor="board-name">שם הלוח</label>
          <input
            id="board-name"
            ref={nameRef}
            className="input"
            value={name}
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'board-name-error' : undefined}
          />
          {errors.name && (
            <span id="board-name-error" className="error">
              {errors.name}
            </span>
          )}
        </div>
        <fieldset className="field" style={{ border: 0, padding: 0 }}>
          <legend className="label" style={{ marginBottom: '0.4rem' }}>
            תבנית
          </legend>
          {templates.isPending && <LoadingState />}
          {templates.data && templates.data.custom.length > 0 && (
            <>
              <p className="label" id="tpl-org" style={{ margin: '0 0 0.3rem' }}>
                תבניות הארגון
              </p>
              <div className="grid" style={{ gap: '0.4rem', marginBottom: '0.8rem' }} role="group" aria-labelledby="tpl-org">
                {templates.data.custom.map((t) => (
                  <label key={t.id} className="card" style={{ display: 'flex', gap: '0.6rem', padding: '0.6rem 0.8rem', cursor: 'pointer', alignItems: 'flex-start' }}>
                    <input type="radio" name="template" value={`custom:${t.id}`} checked={customId === t.id} onChange={() => setCustomId(t.id)} style={{ marginTop: '0.3rem' }} />
                    <Icon name="clipboard" />
                    <span>
                      <strong>{t.name}</strong>
                      <br />
                      <small className="muted">
                        {t.description ? `${t.description} · ` : ''}
                        {t.groupCount} קבוצות, {t.columnCount} עמודות{t.createdByName ? ` · נשמרה ע"י ${t.createdByName}` : ''}
                      </small>
                    </span>
                  </label>
                ))}
              </div>
              <p className="label" id="tpl-builtin" style={{ margin: '0 0 0.3rem' }}>
                תבניות מובנות
              </p>
            </>
          )}
          <div className="grid" style={{ gap: '0.4rem' }}>
            {templates.data?.templates.map((t) => (
              <label key={t.key} className="card" style={{ display: 'flex', gap: '0.6rem', padding: '0.6rem 0.8rem', cursor: 'pointer', alignItems: 'flex-start' }}>
                <input type="radio" name="template" value={t.key} checked={!customId && templateKey === t.key} onChange={() => (setCustomId(null), setTemplateKey(t.key))} style={{ marginTop: '0.3rem' }} />
                <Icon name={t.icon as IconName} />
                <span>
                  <strong>{t.name}</strong>
                  <br />
                  <small className="muted">{t.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {(workspaces.data ?? []).length > 0 && (
          <div className="field">
            <label htmlFor="board-ws">סביבת עבודה</label>
            <select id="board-ws" className="select" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
              <option value="">ללא</option>
              {workspaces.data!.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label htmlFor="board-desc">תיאור (אופציונלי)</label>
          <textarea id="board-desc" className="textarea" value={description} maxLength={1000} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </form>
    </Dialog>
  );
}

export function BoardsPage() {
  usePageTitle('לוחות');
  const { user } = useAuth();
  const boards = useBoards();
  const [creating, setCreating] = useState(false);
  const canCreate = user?.role === 'admin' || user?.role === 'manager';
  const workspaces = useWorkspaces();
  const sorted = [...(boards.data ?? [])].sort((x, y) => Number(y.favorite) - Number(x.favorite));
  const known = new Set((workspaces.data ?? []).map((w) => w.id));
  const sections = [
    ...(workspaces.data ?? []).map((w) => ({ id: w.id, name: w.name, boards: sorted.filter((b) => b.workspaceId === w.id) })),
    { id: 'none', name: known.size ? 'ללא סביבת עבודה' : 'כל הלוחות', boards: sorted.filter((b) => !b.workspaceId || !known.has(b.workspaceId)) },
  ].filter((sec) => sec.boards.length > 0);

  return (
    <>
      <div className="page-header">
        <h1>לוחות</h1>
        {canCreate && (
          <div className="actions">
            <button type="button" className="btn btn-primary" onClick={() => setCreating(true)}>
              <Icon name="plus" /> לוח חדש
            </button>
          </div>
        )}
      </div>
      {boards.isPending && <LoadingState />}
      {boards.isError && <ErrorState message={errorMessage(boards.error)} onRetry={() => boards.refetch()} />}
      {boards.data && boards.data.length === 0 && (
        <div className="card">
          <EmptyState title="אין עדיין לוחות">
            {canCreate ? <p>צרו לוח חדש מתבנית מוכנה ליחידת הבטיחות.</p> : <p>בקשו מבעל לוח להוסיף אתכם.</p>}
          </EmptyState>
        </div>
      )}
      {canCreate && <WorkspaceManager />}
      {boards.data &&
        boards.data.length > 0 &&
        sections.map((sec) => (
          <section key={sec.id} aria-labelledby={`ws-${sec.id}`} className="workspace-section">
            {sections.length > 1 || sec.id !== 'none' ? (
              <h2 id={`ws-${sec.id}`} className="workspace-title">
                {sec.name} <span className="muted">({sec.boards.length})</span>
              </h2>
            ) : (
              <h2 id={`ws-${sec.id}`} className="sr-only">
                {sec.name}
              </h2>
            )}
            <ul className="list-plain grid grid-cards">
              {sec.boards.map((b) => (
                <li key={b.id} className="board-card-wrap">
                  <FavoriteButton boardId={b.id} boardName={b.name} favorite={b.favorite} className="icon-btn board-card-fav" />
                  <Link to={`/boards/${b.id}`} className="card board-card">
                    <h3>{b.name}</h3>
                    {b.description && <span className="muted">{b.description}</span>}
                    <span style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                      <span className="badge">{b.itemCount} פריטים</span>
                      <span className="badge">{BOARD_ROLE_LABELS[b.myRole]}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      {canCreate && <CreateBoardDialog open={creating} onClose={() => setCreating(false)} />}
    </>
  );
}

/** Managers: create, rename and delete workspaces. Deleting one never deletes its boards. */
function WorkspaceManager() {
  const q = useWorkspaces();
  const { create, rename, remove } = useWorkspaceMutations();
  const { toast, confirm } = useFeedback();
  const [name, setName] = useState('');
  const onErr = (e: unknown) => toast(errorMessage(e), 'error');
  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return toast('יש להזין שם לסביבת העבודה', 'error');
    create.mutate(name.trim(), { onSuccess: (w) => (setName(''), toast(`סביבת העבודה "${w.name}" נוצרה`)), onError: onErr });
  };
  return (
    <details className="card workspace-manager">
      <summary>סביבות עבודה{q.data ? ` (${q.data.length})` : ''}</summary>
      <p className="muted">סביבת עבודה מסדרת את רשימת הלוחות (למשל "תחזוקת גזים"). היא אינה נותנת הרשאות: מי רואה לוח נקבע רק לפי חברי הלוח. שיוך לוח נעשה בהגדרות הלוח.</p>
      {q.data && q.data.length > 0 && (
        <ul className="list-plain item-list">
          {q.data.map((w) => (
            <li key={w.id}>
              <WorkspaceName name={w.name} onSave={(n) => rename.mutate({ id: w.id, name: n }, { onSuccess: () => toast('השם עודכן'), onError: onErr })} />
              <button
                type="button"
                className="btn btn-sm"
                style={{ marginInlineStart: 'auto' }}
                aria-label={`מחיקה: סביבת העבודה ${w.name}`}
                onClick={async () => {
                  if (await confirm({ title: 'מחיקת סביבת עבודה', message: `למחוק את "${w.name}"? הלוחות שבה לא יימחקו — הם יעברו ל"ללא סביבת עבודה".`, confirmLabel: 'מחיקה', danger: true }))
                    remove.mutate(w.id, { onSuccess: () => toast('סביבת העבודה נמחקה'), onError: onErr });
                }}
              >
                מחיקה
              </button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="toolbar">
        <label htmlFor="new-ws" className="sr-only">
          שם סביבת עבודה חדשה
        </label>
        <input id="new-ws" className="input" placeholder="שם סביבת עבודה חדשה" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        <button type="submit" className="btn" disabled={create.isPending}>
          <Icon name="plus" /> הוספה
        </button>
      </form>
    </details>
  );
}

function WorkspaceName({ name, onSave }: { name: string; onSave: (n: string) => void }) {
  const [draft, setDraft] = useState(name);
  return (
    <input
      className="cell-input"
      style={{ maxInlineSize: '18rem', fontWeight: 600 }}
      value={draft}
      maxLength={60}
      aria-label={`שם סביבת העבודה ${name}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const t = draft.trim();
        if (!t) return setDraft(name);
        if (t !== name) onSave(t);
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  );
}
