import { findPrimaryStatusColumn, LIMITS, todayIso, isOverdue, type BoardDetail, type CellValue, type DirectoryUser } from '@suboard/shared';
import { useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../../api/client';
import { useBoard, useBoards, useCreateItem, useDeleteItem, useItemActions, useItemActivity, useItemUpdates, useUpdateItem, useUpdateMutations } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { CellEditor } from '../../components/cells/CellEditor';
import { Dialog } from '../../components/Dialog';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Avatar, StatusPill } from '../../components/StatusPill';
import { activityText, actorLabel, formatDateTime } from './activityText';
import { AttachmentsPanel } from './AttachmentsPanel';

type Tab = 'details' | 'updates' | 'files' | 'history';
const TABS: [Tab, string][] = [
  ['details', 'פרטים'],
  ['updates', 'עדכונים'],
  ['files', 'קבצים'],
  ['history', 'היסטוריה'],
];

export function ItemDrawer({
  board,
  itemId,
  users,
  onClose,
  onOpenItem,
}: {
  board: BoardDetail;
  itemId: string | null;
  users: DirectoryUser[];
  onClose: () => void;
  onOpenItem: (id: string) => void;
}) {
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
            {tab === 'details' && <DetailsPanel board={board} itemId={item.id} users={users} onDeleted={onClose} onOpenItem={onOpenItem} />}
            {tab === 'updates' && <UpdatesPanel board={board} itemId={item.id} />}
            {tab === 'files' && <AttachmentsPanel board={board} itemId={item.id} />}
            {tab === 'history' && <HistoryPanel board={board} itemId={item.id} users={users} />}
          </div>
        </>
      )}
    </Dialog>
  );
}

function DetailsPanel({
  board,
  itemId,
  users,
  onDeleted,
  onOpenItem,
}: {
  board: BoardDetail;
  itemId: string;
  users: DirectoryUser[];
  onDeleted: () => void;
  onOpenItem: (id: string) => void;
}) {
  const item = board.items.find((i) => i.id === itemId)!;
  const canEdit = board.myRole !== 'viewer';
  const assignable = board.members.map((m) => ({ id: m.userId, name: m.name }));
  const update = useUpdateItem(board.id);
  const del = useDeleteItem(board.id);
  const { restore, duplicate } = useItemActions(board.id);
  const [moving, setMoving] = useState(false);
  const { toast, confirm } = useFeedback();
  const parent = item.parentId ? board.items.find((i) => i.id === item.parentId) : undefined;
  const [name, setName] = useState(item.name);
  const overdue = isOverdue(item, board.columns, todayIso());

  const save = (patch: { name?: string; groupId?: string; values?: Record<string, CellValue> }) =>
    update.mutate({ itemId, patch }, { onError: (e) => toast(errorMessage(e), 'error') });

  const onDelete = async () => {
    const ok = await confirm({
      title: 'מחיקת פריט',
      message: `להעביר את "${item.name}" לסל המחזור${item.parentId ? '' : ' יחד עם תת-הפריטים שלו'}? אפשר לשחזר במשך 30 יום.`,
      confirmLabel: 'מחיקה',
      danger: true,
    });
    if (!ok) return;
    del.mutate(itemId, {
      onSuccess: () => {
        toast(`"${item.name}" הועבר לסל המחזור`, 'info', { label: 'ביטול', onClick: () => restore.mutate(itemId) });
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

        {parent && (
          <>
            <span className="label">תת-פריט של</span>
            <div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => onOpenItem(parent.id)}>
                {parent.name}
              </button>
            </div>
          </>
        )}
        <label className="label" htmlFor="item-group">
          קבוצה
        </label>
        <select id="item-group" className="select" value={item.groupId} disabled={!canEdit || Boolean(parent)} onChange={(e) => save({ groupId: e.target.value })}>
          {board.groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        {board.columns.map((c) => (
          <FieldRow key={c.id} label={c.title} htmlFor={`f-${c.id}`} labelled={SINGLE_INPUT.has(c.type)}>
            <CellEditor
              id={`f-${c.id}`}
              column={c}
              value={item.values[c.id]}
              users={users}
              assignable={assignable}
              readOnly={!canEdit}
              label={c.title}
              mode="drawer"
              seq={item.seq}
              overdue={overdue && c.settings.role === 'due'}
              onChange={(v) => save({ values: { [c.id]: v } })}
            />
          </FieldRow>
        ))}
      </div>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        נוצר: {formatDateTime(item.createdAt)} · עודכן: {formatDateTime(item.updatedAt)}
      </p>
      {!parent && <SubitemsSection board={board} parentId={item.id} onOpenItem={onOpenItem} />}
      {canEdit && (
        <div className="toolbar" style={{ marginTop: 'var(--space-4)' }}>
          {!parent && (
            <>
              <button
                type="button"
                className="btn"
                disabled={duplicate.isPending}
                onClick={() =>
                  duplicate.mutate(itemId, {
                    onSuccess: (copy) => (toast(`נוצר "${copy.name}"`), onOpenItem(copy.id)),
                    onError: (e) => toast(errorMessage(e), 'error'),
                  })
                }
              >
                שכפול
              </button>
              <button type="button" className="btn" onClick={() => setMoving(true)}>
                העברה ללוח אחר
              </button>
            </>
          )}
          <button type="button" className="btn btn-danger" onClick={onDelete} disabled={del.isPending}>
            <Icon name="trash" /> מחיקת {parent ? 'תת-פריט' : 'פריט'}
          </button>
        </div>
      )}
      {moving && <MoveDialog board={board} itemId={itemId} itemName={item.name} onClose={() => setMoving(false)} onMoved={onDeleted} />}
    </>
  );
}

/** Field types whose editor is a single labelable control (the others label themselves). */
const SINGLE_INPUT = new Set(['text', 'long_text', 'number', 'status', 'date', 'checkbox']);

function SubitemsSection({ board, parentId, onOpenItem }: { board: BoardDetail; parentId: string; onOpenItem: (id: string) => void }) {
  const create = useCreateItem(board.id);
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const kids = board.items.filter((i) => i.parentId === parentId).sort((a, b) => a.position - b.position);
  const parent = board.items.find((i) => i.id === parentId)!;
  const status = findPrimaryStatusColumn(board.columns);
  const canEdit = board.myRole !== 'viewer';
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    create.mutate({ groupId: parent.groupId, parentId, name: n }, { onSuccess: () => setName(''), onError: (err) => toast(errorMessage(err), 'error') });
  };
  return (
    <section aria-labelledby="subitems-h" style={{ marginBottom: 'var(--space-4)' }}>
      <h3 id="subitems-h">
        תת-פריטים <span className="badge">{kids.length}</span>
      </h3>
      {kids.length === 0 && <p className="muted">אין תת-פריטים.</p>}
      <ul className="list-plain item-list">
        {kids.map((k) => {
          const opt = status ? status.settings.options?.find((o) => o.id === k.values[status.id]) : undefined;
          return (
            <li key={k.id}>
              <button type="button" className="btn btn-ghost btn-sm grow" style={{ justifyContent: 'flex-start' }} onClick={() => onOpenItem(k.id)}>
                {k.name}
              </button>
              {status && <StatusPill label={opt?.label} color={opt?.color} />}
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <form onSubmit={submit} className="toolbar">
          <label htmlFor="new-subitem" className="sr-only">
            תת-פריט חדש
          </label>
          <input id="new-subitem" className="input" placeholder="תת-פריט חדש" maxLength={LIMITS.itemName} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn btn-sm" disabled={!name.trim() || create.isPending}>
            <Icon name="plus" size={16} /> הוספה
          </button>
        </form>
      )}
    </section>
  );
}

function MoveDialog({ board, itemId, itemName, onClose, onMoved }: { board: BoardDetail; itemId: string; itemName: string; onClose: () => void; onMoved: () => void }) {
  const boards = useBoards();
  const { move } = useItemActions(board.id);
  const { toast } = useFeedback();
  const [targetId, setTargetId] = useState('');
  const target = useBoard(targetId || board.id);
  const [groupId, setGroupId] = useState('');
  const firstRef = useRef<HTMLSelectElement>(null);
  const candidates = (boards.data ?? []).filter((b) => b.id !== board.id && b.myRole !== 'viewer');
  const groups = targetId && target.data?.id === targetId ? target.data.groups : [];
  const submit = () =>
    move.mutate(
      { itemId, target: { boardId: targetId, groupId: groupId || groups[0]!.id } },
      {
        onSuccess: (r) => {
          toast(r.dropped.length ? `הפריט הועבר. שדות שלא קיימים בלוח היעד ולא הועברו: ${r.dropped.join(', ')}` : 'הפריט הועבר');
          onClose();
          onMoved();
        },
        onError: (e) => toast(errorMessage(e), 'error'),
      },
    );
  return (
    <Dialog
      open
      onClose={onClose}
      title={`העברת "${itemName}"`}
      initialFocusRef={firstRef}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className="btn btn-primary" disabled={!targetId || !groups.length || move.isPending} onClick={submit}>
            העברה
          </button>
        </>
      }
    >
      <p className="muted">תת-פריטים, עדכונים וקבצים עוברים יחד עם הפריט. ערכים עוברים לעמודות עם אותו שם וסוג; השאר לא יועברו (תקבלו פירוט).</p>
      <div className="field">
        <label htmlFor="move-board">ללוח</label>
        <select id="move-board" ref={firstRef} className="select" value={targetId} onChange={(e) => (setTargetId(e.target.value), setGroupId(''))}>
          <option value="">בחירת לוח…</option>
          {candidates.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        {candidates.length === 0 && <span className="hint">אין לוחות נוספים שבהם יש לך הרשאת עריכה.</span>}
      </div>
      {groups.length > 0 && (
        <div className="field">
          <label htmlFor="move-group">לקבוצה</label>
          <select id="move-group" className="select" value={groupId || groups[0]!.id} onChange={(e) => setGroupId(e.target.value)}>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </Dialog>
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
  const [mentions, setMentions] = useState<{ id: string; name: string }[]>([]);
  const [picking, setPicking] = useState(false);
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const mentionable = board.members.filter((m) => m.userId !== user?.id);
  const addMention = (id: string, name: string) => {
    setMentions((x) => (x.some((m) => m.id === id) ? x : [...x, { id, name }]));
    setBody((b) => `${b}${b && !b.endsWith(' ') ? ' ' : ''}@${name} `);
    setPicking(false);
    requestAnimationFrame(() => bodyRef.current?.focus());
  };
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
    // Only people whose @name is still in the text are notified.
    const active = mentions.filter((m) => body.includes(`@${m.name}`)).map((m) => m.id);
    add.mutate({ body, mentions: active }, {
      onSuccess: () => {
        setBody('');
        setMentions([]);
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
              ref={bodyRef}
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
          <div className="toolbar">
            <div className="person-cell">
              <button type="button" className="btn btn-sm" aria-expanded={picking} aria-controls="mention-list" onClick={() => setPicking((p) => !p)} disabled={!mentionable.length}>
                @ אזכור
              </button>
              {picking && (
                <div className="popover" id="mention-list" onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setPicking(false))}>
                  <p className="label" style={{ margin: '0 0 var(--space-1)' }}>
                    אזכור חבר/ת לוח (יקבל/תקבל התראה)
                  </p>
                  <ul className="list-plain">
                    {mentionable.map((m) => (
                      <li key={m.userId}>
                        <button type="button" className="btn btn-ghost btn-sm" style={{ inlineSize: '100%', justifyContent: 'flex-start' }} onClick={() => addMention(m.userId, m.name)}>
                          <Avatar small name={m.name} /> {m.name}
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
            {mentions.length > 0 && (
              <span className="muted" aria-live="polite">
                יקבלו התראה: {mentions.filter((m) => body.includes(`@${m.name}`)).map((m) => m.name).join(', ') || '—'}
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
          <strong>{actorLabel(a)}</strong> {activityText(a, board, users)}
          <br />
          <time className="muted" dateTime={a.createdAt} style={{ fontSize: '0.82rem' }}>
            {formatDateTime(a.createdAt)}
          </time>
        </li>
      ))}
    </ul>
  );
}
