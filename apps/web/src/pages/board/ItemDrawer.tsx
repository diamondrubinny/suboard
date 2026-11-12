import { addDaysIso, isReadonlyColumnType, findDueColumn, formatDateHe, isItemDone, findPrimaryStatusColumn, LIMITS, REACTION_LABELS, REACTIONS, todayIso, isOverdue, type BoardDetail, type CellValue, type DirectoryUser, type ItemUpdate, type Reaction, canEditColumn } from '@suboard/shared';
import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../../api/client';
import { useBoard, useBoards, useCreateItem, useDeleteItem, useItemActions, useItemActivity, useItemUpdates, useUpdateItem, useUpdateMutations, useFollow, useToggleFollow } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { CellEditor } from '../../components/cells/CellEditor';
import { Dialog } from '../../components/Dialog';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { Avatar, StatusPill } from '../../components/StatusPill';
import { activityText, actorLabel, formatDateTime } from './activityText';
import { childrenOf, depthOf, descendantsOf, doneToggle, MAX_DEPTH, subtaskProgress, useUndoableUpdate } from './subtasks';
import { PersonalSection, SaveItemTemplateButton } from './PersonalPanel';
import { appLink } from '../../api/base';
import { AttachmentsPanel } from './AttachmentsPanel';
import { FormatBar, RichText } from '../../components/RichText';
import { LinksSection } from './LinksSection';
import { DependenciesSection } from './DependenciesSection';

// Loaded on demand (QR encoder and the investigation form are not needed for everyday editing).
const InvestigationPanel = lazy(() => import('./FieldPanels').then((m) => ({ default: m.InvestigationPanel })));
const QrDialog = lazy(() => import('./FieldPanels').then((m) => ({ default: m.QrDialog })));

type Tab = 'details' | 'updates' | 'files' | 'investigation' | 'history';
const TABS: [Tab, string][] = [
  ['details', 'פרטים'],
  ['updates', 'עדכונים'],
  ['files', 'קבצים'],
  ['investigation', 'תחקיר'],
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
          <FollowButton itemId={item.id} />
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
            {tab === 'investigation' && (
              <Suspense fallback={<LoadingState />}>
                <InvestigationPanel board={board} itemId={item.id} />
              </Suspense>
            )}
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
  const { restore, duplicate, promote } = useItemActions(board.id);
  const undo = useUndoableUpdate(board);
  const [moving, setMoving] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
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
        toast(`"${item.name}" הועבר לסל המחזור`, 'info', { label: 'ביטול', onClick: () => restore.mutate(itemId) }, 'undo');
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
          <FieldRow key={c.id} label={c.title} htmlFor={`f-${c.id}`} labelled={SINGLE_INPUT.has(c.type)} wide={c.type === 'checklist'}>
            <CellEditor
              id={`f-${c.id}`}
              column={c}
              value={item.values[c.id]}
              users={users}
              assignable={assignable}
              readOnly={!canEditColumn(c, board.myRole)}
              label={c.title}
              mode="drawer"
              seq={item.seq}
              createdBy={item.createdBy}
              updatedAt={item.updatedAt}
              createdAt={item.createdAt}
              onSetValue={(cid, v) => undo.setValue(item, cid, v)}
              onMoveGroup={item.parentId ? undefined : (groupId) => update.mutate({ itemId: item.id, patch: { groupId } })}
              columns={board.columns}
              values={item.values}
              linkStat={board.linkStats?.[item.id]}
              itemId={item.id}
              boardId={board.id}
              related={board.relations?.[item.id]?.[c.id]}
              mirrored={board.mirrors?.[item.id]?.[c.id]}
              fileCount={board.fileCounts?.[item.id]}
              timeTotal={board.timeTotals?.[item.id]}
              canLogTime={board.myRole !== 'viewer'}
              overdue={overdue && c.settings.role === 'due'}
              onChange={(v) => undo.setValue(item, c.id, v)}
            />
            {c.settings.description && <span className="hint">{c.settings.description}</span>}
            {c.type === 'date' && canEdit && <DateShortcuts label={c.title} value={item.values[c.id]} onPick={(v) => undo.setValue(item, c.id, v)} />}
          </FieldRow>
        ))}
      </div>
      <p className="muted" style={{ fontSize: '0.85rem' }}>
        נוצר: {formatDateTime(item.createdAt)} · עודכן: {formatDateTime(item.updatedAt)}
      </p>
      {depthOf(board, item) < MAX_DEPTH && <SubitemsSection board={board} parentId={item.id} users={users} onOpenItem={onOpenItem} />}
      <PersonalSection itemId={item.id} />
      <LinksSection itemId={item.id} boardId={board.id} canEdit={canEdit} />
      {!parent && <DependenciesSection board={board} itemId={item.id} onOpenItem={onOpenItem} />}
      <div className="toolbar" style={{ marginTop: 'var(--space-3)' }}>
        <button type="button" className="btn btn-sm" onClick={() => setQrOpen(true)}>
          <Icon name="grid" /> קוד QR
        </button>
        <button
          type="button"
          className="btn btn-sm"
          onClick={async () => {
            const url = appLink(`/boards/${board.id}?item=${item.id}`);
            try {
              await navigator.clipboard.writeText(url);
              toast('הקישור לפריט הועתק');
            } catch {
              toast(`לא ניתן להעתיק אוטומטית. הקישור: ${url}`, 'error');
            }
          }}
        >
          <Icon name="open" /> העתקת קישור
        </button>
        {canEdit && <SaveItemTemplateButton item={item} subCount={descendantsOf(board, item.id).length} />}
        {parent && canEdit && (
          <button
            type="button"
            className="btn btn-sm"
            disabled={promote.isPending}
            onClick={() => promote.mutate(item.id, { onSuccess: () => toast(`"${item.name}" הפך לפריט ראשי`), onError: (e) => toast(errorMessage(e), 'error') })}
          >
            הפיכה לפריט ראשי
          </button>
        )}
      </div>
      {qrOpen && (
        <Suspense fallback={null}>
          <QrDialog board={board} itemId={item.id} open onClose={() => setQrOpen(false)} />
        </Suspense>
      )}
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

/** Sub-items ("action items") of an item: done checkbox, assignee, due date, quick add, progress. */
function SubitemsSection({ board, parentId, users, onOpenItem }: { board: BoardDetail; parentId: string; users: DirectoryUser[]; onOpenItem: (id: string) => void }) {
  const create = useCreateItem(board.id);
  const { toast } = useFeedback();
  const { setValue } = useUndoableUpdate(board);
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const kids = childrenOf(board, parentId);
  const parent = board.items.find((i) => i.id === parentId)!;
  const status = findPrimaryStatusColumn(board.columns);
  const toggle = doneToggle(board);
  const personCol = board.columns.find((c) => c.type === 'person');
  const dueCol = findDueColumn(board.columns);
  const today = todayIso();
  const canEdit = board.myRole !== 'viewer';
  const prog = subtaskProgress(board, parentId);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    create.mutate(
      { groupId: parent.groupId, parentId, name: n },
      { onSuccess: () => (setName(''), requestAnimationFrame(() => inputRef.current?.focus())), onError: (err) => toast(errorMessage(err), 'error') },
    );
  };
  return (
    <section aria-labelledby="subitems-h" className="subtasks">
      <h3 id="subitems-h">
        תת-פריטים <span className="badge">{kids.length}</span>
      </h3>
      {prog.total > 0 && toggle && (
        <div className="subtasks-progress">
          <span className="progress-bar" role="img" aria-label={`${prog.done} מתוך ${prog.total} תת-פריטים בוצעו`}>
            <span style={{ inlineSize: `${Math.round((prog.done / prog.total) * 100)}%` }} />
          </span>
          <span className="muted num" aria-hidden="true">
            {prog.done}/{prog.total} בוצעו
          </span>
        </div>
      )}
      {kids.length === 0 && <p className="muted">אין עדיין תת-פריטים. פרקו את הפריט למשימות קטנות — לכל אחת אחראי ותאריך משלה.</p>}
      <ul className="list-plain subtask-list">
        {kids.map((k) => {
          const opt = status ? status.settings.options?.find((o) => o.id === k.values[status.id]) : undefined;
          const done = isItemDone(k, status);
          const people = personCol && Array.isArray(k.values[personCol.id]) ? (k.values[personCol.id] as string[]).map((id) => users.find((u) => u.id === id)?.name).filter(Boolean) : [];
          const due = dueCol && typeof k.values[dueCol.id] === 'string' ? (k.values[dueCol.id] as string) : null;
          const late = Boolean(due && due < today && !done);
          const grand = childrenOf(board, k.id).length;
          return (
            <li key={k.id} className={`subtask${done ? ' done' : ''}`}>
              {toggle && (
                <DoneCheckbox
                  done={done}
                  disabled={!canEdit}
                  label={`בוצע: ${k.name}`}
                  onToggle={(on) => {
                    setValue(k, toggle.column.id, on ? toggle.doneId : toggle.openId, on ? `"${k.name}" סומן כבוצע` : `"${k.name}" נפתח מחדש`);
                    // The last open sub-item was just closed: offer to close the parent too (never automatic).
                    const othersDone = kids.every((x) => x.id === k.id || isItemDone(x, status));
                    if (on && othersDone && !isItemDone(parent, status)) {
                      window.setTimeout(
                        () =>
                          toast(`כל תת-הפריטים של "${parent.name}" בוצעו`, 'info', { label: 'סימון הפריט כבוצע', onClick: () => setValue(parent, toggle.column.id, toggle.doneId, `"${parent.name}" סומן כבוצע`) }, 'undo'),
                        600,
                      );
                    }
                  }}
                />
              )}
              <button type="button" className="subtask-name" onClick={() => onOpenItem(k.id)}>
                {k.name}
                {grand > 0 && <span className="badge">{grand} תת-פריטים</span>}
              </button>
              <span className="subtask-meta">
                {people.length > 0 && <span className="muted">{people.join(', ')}</span>}
                {due && (
                  <span className={late ? 'badge danger' : 'muted'}>
                    {late && <span className="sr-only">באיחור: </span>}
                    {formatDateHe(due)}
                  </span>
                )}
                {status && !toggle && <StatusPill label={opt?.label} color={opt?.color} />}
                {status && toggle && !done && opt && <StatusPill label={opt.label} color={opt.color} />}
              </span>
            </li>
          );
        })}
      </ul>
      {canEdit && (
        <form onSubmit={submit} className="toolbar">
          <label htmlFor="new-subitem" className="sr-only">
            תת-פריט חדש
          </label>
          <input id="new-subitem" ref={inputRef} className="input" placeholder="תת-פריט חדש (Enter להוספה)" maxLength={LIMITS.itemName} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="btn btn-sm" disabled={!name.trim() || create.isPending}>
            <Icon name="plus" size={16} /> הוספה
          </button>
        </form>
      )}
    </section>
  );
}

/** Checkbox that reflects the click at once (no flicker while the change is being saved). */
function DoneCheckbox({ done, disabled, label, onToggle }: { done: boolean; disabled: boolean; label: string; onToggle: (on: boolean) => void }) {
  const [local, setLocal] = useState<boolean | null>(null);
  useEffect(() => setLocal(null), [done]);
  useEffect(() => {
    if (local === null) return;
    const t = window.setTimeout(() => setLocal(null), 4000); // a failed save falls back to the stored state
    return () => window.clearTimeout(t);
  }, [local]);
  return (
    <input
      type="checkbox"
      checked={local ?? done}
      disabled={disabled}
      aria-label={label}
      onChange={(e) => {
        setLocal(e.target.checked);
        onToggle(e.target.checked);
      }}
    />
  );
}

/** Quick picks next to a date field: today / tomorrow / in a week / clear. */
function DateShortcuts({ label, value, onPick }: { label: string; value: unknown; onPick: (v: string | null) => void }) {
  const today = todayIso();
  const picks: [string, string | null][] = [
    ['היום', today],
    ['מחר', addDaysIso(today, 1)],
    ['בעוד שבוע', addDaysIso(today, 7)],
  ];
  return (
    <div className="date-shortcuts" role="group" aria-label={`קיצורים: ${label}`}>
      {picks.map(([text, v]) => (
        <button key={text} type="button" className="chip-btn" aria-pressed={value === v} onClick={() => onPick(v)}>
          {text}
        </button>
      ))}
      {typeof value === 'string' && value && (
        <button type="button" className="chip-btn" onClick={() => onPick(null)}>
          ניקוי
        </button>
      )}
    </div>
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

/** `wide` fields (e.g. a checklist) take the full drawer width with the label above them. */
function FieldRow({ label, htmlFor, labelled, wide, children }: { label: string; htmlFor: string; labelled: boolean; wide?: boolean; children: React.ReactNode }) {
  const cls = wide ? 'label full' : 'label';
  return (
    <>
      {labelled ? (
        <label className={cls} htmlFor={htmlFor}>
          {label}
        </label>
      ) : (
        <span className={cls} aria-hidden="true">
          {label}
        </span>
      )}
      <div className={wide ? 'full' : undefined}>{children}</div>
    </>
  );
}

/** Follow / unfollow toggle with follower count (notifications on updates and status changes). */
function FollowButton({ itemId }: { itemId: string }) {
  const q = useFollow(itemId);
  const toggle = useToggleFollow(itemId);
  const { toast } = useFeedback();
  if (!q.data) return null;
  const { following, count } = q.data;
  return (
    <div className="follow-bar">
      <button
        type="button"
        className="btn btn-sm"
        aria-pressed={following}
        disabled={toggle.isPending}
        onClick={() =>
          toggle.mutate(!following, {
            onSuccess: (f) => toast(f.following ? 'תקבל/י התראות על עדכונים ושינויי סטטוס בפריט' : 'הפסקת לעקוב אחרי הפריט'),
            onError: (e) => toast(errorMessage(e), 'error'),
          })
        }
      >
        <Icon name="eye" size={16} /> {following ? 'במעקב' : 'מעקב אחרי הפריט'}
      </button>
      <span className="muted">{count === 1 ? 'עוקב/ת אחד/ת' : `${count} עוקבים`}</span>
    </div>
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
  const onDelete = async (u: ItemUpdate) => {
    const replies = q.data?.filter((r) => r.parentId === u.id).length ?? 0;
    const message = replies ? `למחוק את העדכון ואת ${replies} התשובות אליו?` : u.parentId ? 'למחוק את התשובה?' : 'למחוק את העדכון?';
    if (await confirm({ title: u.parentId ? 'מחיקת תשובה' : 'מחיקת עדכון', message, confirmLabel: 'מחיקה', danger: true })) {
      remove.mutate(u.id, { onError: (e) => toast(errorMessage(e), 'error') });
    }
  };

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
            <FormatBar target={bodyRef} value={body} onChange={setBody} label="עיצוב העדכון" />
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
              אפשר לעצב: **מודגש**, *נטוי*, שורה שמתחילה ב-"- " לרשימה; כתובת https הופכת לקישור. אין להזין מידע רפואי או פרטים מזהים רגישים של נפגעים או עובדים.
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
      {q.data && (
        <ul className="list-plain">
          {q.data
            .filter((u) => !u.parentId)
            .map((u) => {
              const replies = q.data.filter((r) => r.parentId === u.id).reverse(); // oldest first inside a thread
              return (
                <li key={u.id}>
                  <UpdateCard board={board} itemId={itemId} update={u} canEdit={canEdit} onDelete={onDelete} />
                  {(replies.length > 0 || canEdit) && (
                    <div className="update-thread">
                      {replies.length > 0 && (
                        <ul className="list-plain" aria-label={`${replies.length} תשובות לעדכון של ${u.userName}`}>
                          {replies.map((r) => (
                            <li key={r.id}>
                              <UpdateCard board={board} itemId={itemId} update={r} canEdit={canEdit} onDelete={onDelete} reply />
                            </li>
                          ))}
                        </ul>
                      )}
                      {canEdit && <ReplyForm itemId={itemId} parent={u} />}
                    </div>
                  )}
                </li>
              );
            })}
        </ul>
      )}
    </>
  );
}

function UpdateCard({
  board,
  itemId,
  update: u,
  canEdit,
  onDelete,
  reply = false,
}: {
  board: BoardDetail;
  itemId: string;
  update: ItemUpdate;
  canEdit: boolean;
  onDelete: (u: ItemUpdate) => void;
  reply?: boolean;
}) {
  const { user } = useAuth();
  return (
    <article className={`update${reply ? ' update-reply' : ''}`} aria-label={`${reply ? 'תשובה' : 'עדכון'} מאת ${u.userName}`}>
      <header>
        <Avatar small name={u.userName} />
        <strong>{u.userName}</strong>
        <time className="muted" dateTime={u.createdAt}>
          {formatDateTime(u.createdAt)}
        </time>
        {canEdit && (u.userId === user?.id || board.myRole === 'owner') && (
          <button type="button" className="icon-btn" style={{ marginInlineStart: 'auto' }} aria-label={reply ? 'מחיקת התשובה' : 'מחיקת העדכון'} onClick={() => onDelete(u)}>
            <Icon name="trash" size={16} />
          </button>
        )}
      </header>
      <RichText className="body" text={u.body} />
      <Reactions itemId={itemId} update={u} canEdit={canEdit} />
    </article>
  );
}

/** Reaction chips (toggle buttons) plus a small picker with the fixed set. */
function Reactions({ itemId, update: u, canEdit }: { itemId: string; update: ItemUpdate; canEdit: boolean }) {
  const { react } = useUpdateMutations(itemId);
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const wrapRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);
  const toggle = (emoji: Reaction, on: boolean) => {
    setOpen(false);
    react.mutate({ updateId: u.id, emoji, on }, { onError: (e) => toast(errorMessage(e), 'error') });
  };
  if (!u.reactions.length && !canEdit) return null;
  const unused = REACTIONS.filter((e) => !u.reactions.some((r) => r.emoji === e));
  return (
    <div className="reactions">
      {u.reactions.map((r) => (
        <button
          key={r.emoji}
          type="button"
          className="reaction"
          aria-pressed={r.mine}
          disabled={!canEdit || react.isPending}
          title={r.users.join(', ')}
          aria-label={`${REACTION_LABELS[r.emoji]}: ${r.count} (${r.users.join(', ')})${r.mine ? ' — כולל אותך' : ''}`}
          onClick={() => toggle(r.emoji, !r.mine)}
        >
          <span aria-hidden="true">{r.emoji}</span> {r.count}
        </button>
      ))}
      {canEdit && unused.length > 0 && (
        <span
          className="person-cell"
          ref={wrapRef}
          onBlur={(e) => {
            // Keyboard: Tab moved focus elsewhere. (A click that does not focus — e.g. Safari — has no
            // relatedTarget and is handled by the outside-mousedown listener instead.)
            if (open && e.relatedTarget && !e.currentTarget.contains(e.relatedTarget as Node)) setOpen(false);
          }}
        >
          <button ref={btnRef} type="button" className="reaction reaction-add" aria-expanded={open} aria-label="הוספת תגובה" onClick={() => setOpen((x) => !x)}>
            <span aria-hidden="true">＋</span>
          </button>
          {open && (
            <div
              className="popover reaction-picker"
              role="group"
              aria-label="בחירת תגובה"
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.stopPropagation();
                  setOpen(false);
                  btnRef.current?.focus();
                }
              }}
            >
              {unused.map((e, i) => (
                <button key={e} type="button" className="reaction" aria-label={REACTION_LABELS[e]} title={REACTION_LABELS[e]} autoFocus={i === 0} onClick={() => toggle(e, true)}>
                  <span aria-hidden="true">{e}</span>
                </button>
              ))}
            </div>
          )}
        </span>
      )}
    </div>
  );
}

function ReplyForm({ itemId, parent }: { itemId: string; parent: ItemUpdate }) {
  const { add } = useUpdateMutations(itemId);
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const id = `reply-${parent.id}`;
  if (!open)
    return (
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)} aria-label={`תשובה לעדכון של ${parent.userName}`}>
        <Icon name="reply" size={16} /> תשובה
      </button>
    );
  return (
    <form
      noValidate
      className="reply-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim()) return setError('יש לכתוב תשובה');
        setError(null);
        add.mutate(
          { body, parentId: parent.id },
          {
            onSuccess: () => {
              setBody('');
              setOpen(false);
              toast('התשובה נוספה');
            },
            onError: (err) => setError(errorMessage(err)),
          },
        );
      }}
    >
      <div className="field">
        <label htmlFor={id}>תשובה ל{parent.userName}</label>
        <textarea
          id={id}
          className="textarea"
          rows={2}
          autoFocus
          value={body}
          maxLength={LIMITS.updateBody}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))}
          aria-invalid={Boolean(error)}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        {error && (
          <span id={`${id}-error`} className="error" role="alert">
            {error}
          </span>
        )}
      </div>
      <div className="toolbar">
        <button type="submit" className="btn btn-primary btn-sm" disabled={add.isPending}>
          {add.isPending ? 'שולח…' : 'שליחת תשובה'}
        </button>
        <button type="button" className="btn btn-sm" onClick={() => setOpen(false)}>
          ביטול
        </button>
      </div>
    </form>
  );
}

function HistoryPanel({ board, itemId, users }: { board: BoardDetail; itemId: string; users: DirectoryUser[] }) {
  const q = useItemActivity(itemId);
  const { setValue } = useUndoableUpdate(board);
  const item = board.items.find((i) => i.id === itemId);
  const canEdit = board.myRole !== 'viewer';
  if (q.isPending) return <LoadingState />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  if (!q.data.length) return <p className="muted">אין היסטוריה.</p>;
  return (
    <ul className="list-plain activity-list">
      {q.data.map((a) => {
        // A recorded value change of a column that still exists can be put back (long text keeps no old value).
        const column = a.action === 'item_value_changed' ? board.columns.find((c) => c.id === a.detail.columnId) : undefined;
        const restorable = Boolean(canEdit && item && column && 'from' in a.detail && !isReadonlyColumnType(column.type) && column.type !== 'checklist' && JSON.stringify(item.values[column.id] ?? null) !== JSON.stringify(a.detail.from ?? null));
        return (
          <li key={a.id} className="activity-row">
            <span>
              <strong>{actorLabel(a)}</strong> {activityText(a, board, users)}
              <br />
              <time className="muted" dateTime={a.createdAt} style={{ fontSize: '0.82rem' }}>
                {formatDateTime(a.createdAt)}
              </time>
            </span>
            {restorable && column && item && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label={`שחזור הערך הקודם של ${column.title} (מ-${formatDateTime(a.createdAt)})`}
                onClick={() => setValue(item, column.id, (a.detail.from ?? null) as CellValue, `"${column.title}" שוחזר לערך קודם`)}
              >
                <Icon name="history" size={16} /> שחזור
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
