import { BOARD_ROLE_LABELS, createBoardSchema } from '@suboard/shared';
import { useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useBoards, useCreateBoard, useTemplates } from '../api/hooks';
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
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
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
      const board = await create.mutateAsync(parsed.data);
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
          <div className="grid" style={{ gap: '0.4rem' }}>
            {templates.data?.map((t) => (
              <label key={t.key} className="card" style={{ display: 'flex', gap: '0.6rem', padding: '0.6rem 0.8rem', cursor: 'pointer', alignItems: 'flex-start' }}>
                <input type="radio" name="template" value={t.key} checked={templateKey === t.key} onChange={() => setTemplateKey(t.key)} style={{ marginTop: '0.3rem' }} />
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
      {boards.data && boards.data.length > 0 && (
        <ul className="list-plain grid grid-cards">
          {[...boards.data].sort((x, y) => Number(y.favorite) - Number(x.favorite)).map((b) => (
            <li key={b.id} className="board-card-wrap">
              <FavoriteButton boardId={b.id} boardName={b.name} favorite={b.favorite} className="icon-btn board-card-fav" />
              <Link to={`/boards/${b.id}`} className="card board-card">
                <h2>{b.name}</h2>
                {b.description && <span className="muted">{b.description}</span>}
                <span style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
                  <span className="badge">{b.itemCount} פריטים</span>
                  <span className="badge">{BOARD_ROLE_LABELS[b.myRole]}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {canCreate && <CreateBoardDialog open={creating} onClose={() => setCreating(false)} />}
    </>
  );
}
