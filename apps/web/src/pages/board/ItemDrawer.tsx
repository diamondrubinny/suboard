import { LIMITS, todayIso, isOverdue, type BoardDetail, type CellValue, type DirectoryUser } from '@suboard/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage } from '../../api/client';
import { useDeleteItem, useItemActivity, useItemUpdates, useUpdateItem, useUpdateMutations } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { CellEditor } from '../../components/cells/CellEditor';
import { Dialog } from '../../components/Dialog';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Avatar } from '../../components/StatusPill';
import { activityText, formatDateTime } from './activityText';
import { AttachmentsPanel } from './AttachmentsPanel';

type Tab = 'details' | 'updates' | 'files' | 'history';
const TABS: [Tab, string][] = [
  ['details', 'פרטים'],
  ['updates', 'עדכונים'],
  ['files', 'קבצים'],
  ['history', 'היסטוריה'],
];

export function ItemDrawer({ board, itemId, users, onClose }: { board: BoardDetail; itemId: string | null; users: DirectoryUser[]; onClose: () => void }) {
  const item = board.items.find((i) => i.id === itemId) ?? null;
  const [tab, setTab] = useState<Tab>('details');

  return (
    <Dialog open={Boolean(item)} onClose={onClose} title={item?.name ?? ''} variant="drawer">
      {item && (
        <>
          <div role="tablist" aria-label="מידע על הפריט" className="tabs">
            {TABS.map(([key, label]) => (
              <button
                key={key}
                type="button"
                role="tab"
                id={`tab-${key}`}
                aria-selected={tab === key}
                aria-controls={`panel-${key}`}
                tabIndex={tab === key ? 0 : -1}
                onClick={() => setTab(key)}
                onKeyDown={(e) => {
                  const order = TABS.map(([k]) => k);
                  const idx = order.indexOf(key);
                  const n = order.length;
                  // RTL: ArrowLeft moves forward; Home/End jump to the ends.
                  const next =
                    e.key === 'ArrowLeft' ? order[(idx + 1) % n] : e.key === 'ArrowRight' ? order[(idx + n - 1) % n] : e.key === 'Home' ? order[0] : e.key === 'End' ? order[n - 1] : null;
                  if (next) {
                    setTab(next);
                    document.getElementById(`tab-${next}`)?.focus();
                  }
                }}
              >
                {label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
            {tab === 'details' && <DetailsPanel board={board} itemId={item.id} users={users} onDeleted={onClose} />}
            {tab === 'updates' && <UpdatesPanel board={board} itemId={item.id} />}
            {tab === 'files' && <AttachmentsPanel board={board} itemId={item.id} />}
            {tab === 'history' && <HistoryPanel board={board} itemId={item.id} users={users} />}
          </div>
        </>
      )}
    </Dialog>
  );
}

function DetailsPanel({ board, itemId, users, onDeleted }: { board: BoardDetail; itemId: string; users: DirectoryUser[]; onDeleted: () => void }) {
  const item = board.items.find((i) => i.id === itemId)!;
  const canEdit = board.myRole !== 'viewer';
  const assignable = board.members.map((m) => ({ id: m.userId, name: m.name }));
  const update = useUpdateItem(board.id);
  const del = useDeleteItem(board.id);
  const { toast, confirm } = useFeedback();
  const [name, setName] = useState(item.name);
  const overdue = isOverdue(item, board.columns, todayIso());

  const save = (patch: { name?: string; groupId?: string; values?: Record<string, CellValue> }) =>
    update.mutate({ itemId, patch }, { onError: (e) => toast(errorMessage(e), 'error') });

  const onDelete = async () => {
    const ok = await confirm({ title: 'מחיקת פריט', message: `למחוק את "${item.name}"? הפעולה תמחק גם את העדכונים שלו ואינה ניתנת לביטול.`, confirmLabel: 'מחיקה', danger: true });
    if (!ok) return;
    del.mutate(itemId, {
      onSuccess: () => {
        toast('הפריט נמחק');
        onDeleted();
      },
      onError: (e) => toast(errorMessage(e), 'error'),
    });
  };

  return (
    <>
      <div className="fields-grid">
        <label className="label" htmlFor="item-name">
          שם הפריט
        </label>
        {canEdit ? (
          <input
            id="item-name"
            className="input"
            value={name}
            maxLength={LIMITS.itemName}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => {
              const n = name.trim();
              if (!n) return setName(item.name);
              if (n !== item.name) save({ name: n });
            }}
          />
        ) : (
          <span id="item-name">{item.name}</span>
        )}

        <label className="label" htmlFor="item-group">
          קבוצה
        </label>
        <select id="item-group" className="select" value={item.groupId} disabled={!canEdit} onChange={(e) => save({ groupId: e.target.value })}>
          {board.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        {board.columns.map((c) => (
          <FieldRow key={c.id} label={c.title} htmlFor={`f-${c.id}`} labelled={c.type !== 'person'}>
            <CellEditor
              id={`f-${c.id}`}
              column={c}
              value={item.values[c.id]}
              users={users}
              assignable={assignable}
              readOnly={!canEdit}
              label={c.title}
              mode="drawer"
              overdue={overdue && c.settings.role === 'due'}
              onChange={(v) => save({ values: { [c.id]: v } })}
            />
          </FieldRow>
        ))}
      </div>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        נוצר: {formatDateTime(item.createdAt)} · עודכן: {formatDateTime(item.updatedAt)}
      </p>
      {canEdit && (
        <button type="button" className="btn btn-danger" onClick={onDelete} disabled={del.isPending}>
          <Icon name="trash" /> מחיקת פריט
        </button>
      )}
    </>
  );
}

function FieldRow({ label, htmlFor, labelled, children }: { label: string; htmlFor: string; labelled: boolean; children: React.ReactNode }) {
  return (
    <>
      {labelled ? (
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className="label" aria-hidden="true">
          {label}
        </span>
      )}
      <div>{children}</div>
    </>
  );
}

function UpdatesPanel({ board, itemId }: { board: BoardDetail; itemId: string }) {
  const { user } = useAuth();
  const q = useItemUpdates(itemId);
  const { add, remove } = useUpdateMutations(itemId);
  const { toast, confirm } = useFeedback();
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const canEdit = board.myRole !== 'viewer';

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim()) return setError('יש לכתוב תוכן לעדכון');
    setError(null);
    add.mutate(body, {
      onSuccess: () => {
        setBody('');
        toast('העדכון נוסף');
      },
      onError: (err) => setError(errorMessage(err)),
    });
  };

  return (
    <>
      {canEdit && (
        <form onSubmit={submit} noValidate style={{ marginBottom: '1.25rem' }}>
          <div className="field">
            <label htmlFor="update-body">עדכון חדש</label>
            <textarea
              id="update-body"
              className="textarea"
              value={body}
              maxLength={LIMITS.updateBody}
              onChange={(e) => setBody(e.target.value)}
              aria-invalid={Boolean(error)}
              aria-describedby={`update-hint${error ? ' update-error' : ''}`}
            />
            <span id="update-hint" className="hint">
              אין להזין מידע רפואי או פרטים מזהים רגישים של נפגעים או עובדים.
            </span>
            {error && (
              <span id="update-error" className="error" role="alert">
                {error}
              </span>
            )}
          </div>
          <button type="submit" className="btn btn-primary" disabled={add.isPending}>
            {add.isPending ? 'שולח…' : 'הוספת עדכון'}
          </button>
        </form>
      )}
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <p className="muted">אין עדיין עדכונים.</p>}
      <ul className="list-plain">
        {q.data?.map((u) => (
          <li key={u.id}>
            <article className="update" aria-label={`עדכון מאת ${u.userName}`}>
              <header>
                <Avatar small name={u.userName} />
                <strong>{u.userName}</strong>
                <time className="muted" dateTime={u.createdAt}>
                  {formatDateTime(u.createdAt)}
                </time>
                {canEdit && (u.userId === user?.id || board.myRole === 'owner') && (
                  <button
                    type="button"
                    className="icon-btn"
                    style={{ marginInlineStart: 'auto' }}
                    aria-label="מחיקת העדכון"
                    onClick={async () => {
                      if (await confirm({ title: 'מחיקת עדכון', message: 'למחוק את העדכון?', confirmLabel: 'מחיקה', danger: true })) {
                        remove.mutate(u.id, { onError: (e) => toast(errorMessage(e), 'error') });
                      }
                    }}
                  >
                    <Icon name="trash" size={16} />
                  </button>
                )}
              </header>
              <div className="body">{u.body}</div>
            </article>
          </li>
        ))}
      </ul>
    </>
  );
}

function HistoryPanel({ board, itemId, users }: { board: BoardDetail; itemId: string; users: DirectoryUser[] }) {
  const q = useItemActivity(itemId);
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <p className="muted">אין היסטוריה.</p>;
  return (
    <ul className="list-plain activity-list">
      {q.data.map((a) => (
        <li key={a.id}>
          <strong>{a.userName ?? 'מערכת'}</strong> {activityText(a, board, users)}
          <br />
          <time className="muted" dateTime={a.createdAt} style={{ fontSize: '0.82rem' }}>
            {formatDateTime(a.createdAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}
