import { COLUMN_WIDTH, PALETTE, todayIso, isOverdue, type BoardDetail, type CellValue, type Column, type DirectoryUser, type Group, type Item, type ViewConfig, evaluateFormula } from '@suboard/shared';
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { errorMessage } from '../../api/client';
import { useCreateItem, useGroupMutations, useUpdateItem } from '../../api/hooks';
import { CellEditor } from '../../components/cells/CellEditor';
import { useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { depthOf, doneToggle, MAX_DEPTH, subtaskProgress, useUndoableUpdate } from './subtasks';
import { sortItems } from './viewLogic';

interface Props {
  board: BoardDetail;
  /** Filtered items (parents and sub-items). */
  items: Item[];
  users: DirectoryUser[];
  onOpenItem: (itemId: string) => void;
  filtered: boolean;
  config: ViewConfig;
  onSort: (sort: ViewConfig['sort']) => void;
  /** New width (px) for a column, or null to reset it. */
  onResize: (columnId: string, width: number | null) => void;
  selected: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
}

function GroupNameInput({ group, boardId, canEdit }: { group: Group; boardId: string; canEdit: boolean }) {
  const { update } = useGroupMutations(boardId);
  const { toast } = useFeedback();
  const [draft, setDraft] = useState(group.name);
  if (!canEdit) return <h2>{group.name}</h2>;
  const commit = () => {
    const name = draft.trim();
    if (!name || name === group.name) return setDraft(group.name);
    update.mutate({ groupId: group.id, patch: { name } }, { onError: (e) => (toast(errorMessage(e), 'error'), setDraft(group.name)) });
  };
  return (
    <h2>
      <input
        className="cell-input group-name-input"
        value={draft}
        maxLength={80}
        aria-label={`שם הקבוצה: ${group.name}`}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setDraft(group.name);
        }}
      />
    </h2>
  );
}

/** "+ new item" (or "+ sub-item") row; keeps focus in the input to add several in a row. */
function AddRow({
  boardId,
  groupId,
  parentId,
  colSpan,
  label,
  sub,
  depth = 1,
  focus = 0,
}: {
  boardId: string;
  groupId: string;
  parentId?: string;
  colSpan: number;
  label: string;
  sub?: boolean;
  /** Nesting level of the rows this input adds (for the indent). */
  depth?: number;
  /** Changes each time the parent's "+ sub-item" button is pressed: the input takes focus. */
  focus?: number;
}) {
  const create = useCreateItem(boardId);
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (focus) inputRef.current?.focus();
  }, [focus]);
  const submit = () => {
    const n = name.trim();
    if (!n || create.isPending) return;
    create.mutate(
      { groupId, name: n, ...(parentId ? { parentId } : {}) },
      { onSuccess: () => (setName(''), toast(`${sub ? 'תת-הפריט' : 'הפריט'} "${n}" נוסף`)), onError: (e) => toast(errorMessage(e), 'error') },
    );
  };
  return (
    <tr className={sub ? 'add-row sub-row' : 'add-row'} style={sub ? ({ ['--depth' as string]: depth } as React.CSSProperties) : undefined}>
      <td className="col-select" />
      <td className="col-name">
        <input
          className="cell-input"
          placeholder={sub ? '+ תת-פריט (Enter לשמירה)' : '+ פריט חדש (Enter לשמירה)'}
          aria-label={label}
          value={name}
          maxLength={300}
          ref={inputRef}
          disabled={create.isPending}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') setName('');
          }}
        />
      </td>
      <td colSpan={colSpan} />
    </tr>
  );
}

function ItemNameInput({ item, onCommit }: { item: Item; onCommit: (name: string) => void }) {
  const [draft, setDraft] = useState(item.name);
  const [last, setLast] = useState(item.name);
  if (item.name !== last) {
    setLast(item.name);
    setDraft(item.name);
  }
  return (
    <input
      className="cell-input"
      value={draft}
      maxLength={300}
      aria-label={`שם ${item.parentId ? 'תת-הפריט' : 'הפריט'}: ${item.name}`}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = draft.trim();
        if (!n) return setDraft(item.name);
        if (n !== item.name) onCommit(n);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'Escape') setDraft(item.name);
      }}
    />
  );
}

/**
 * Column header that sorts on click: none → ascending → descending → none (aria-sort reflects it),
 * with a resize handle on its inline-end edge (mouse / touch drag, or keyboard on the focused handle).
 */
function SortHeader({
  id,
  title,
  config,
  onSort,
  onResize,
  className,
}: {
  id: string;
  title: string;
  config: ViewConfig;
  onSort: Props['onSort'];
  onResize: Props['onResize'];
  className: string;
}) {
  const dir = config.sort?.by === id ? config.sort.dir : undefined;
  const next = (): ViewConfig['sort'] => (!dir ? { by: id as never, dir: 'asc' } : dir === 'asc' ? { by: id as never, dir: 'desc' } : undefined);
  const width = config.widths?.[id];
  const thRef = useRef<HTMLTableCellElement>(null);
  // Rendered width for aria-valuenow when no width is set (a focusable separator must report a value).
  const [measured, setMeasured] = useState<number | null>(null);
  useEffect(() => {
    const el = thRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setMeasured(Math.round(el.getBoundingClientRect().width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const clamp = (w: number) => Math.round(Math.min(COLUMN_WIDTH.max, Math.max(COLUMN_WIDTH.min, w)));
  const current = () => width ?? Math.round(thRef.current?.getBoundingClientRect().width ?? 160);
  const rtl = () => getComputedStyle(thRef.current ?? document.documentElement).direction === 'rtl';

  const onPointerDown = (e: PointerEvent<HTMLSpanElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    handle.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const start = current();
    const isRtl = rtl();
    let w = start;
    const move = (ev: globalThis.PointerEvent) => {
      w = clamp(start + (isRtl ? startX - ev.clientX : ev.clientX - startX));
      // Live preview without re-rendering the whole table; committed on release.
      if (thRef.current) Object.assign(thRef.current.style, { width: `${w}px`, minWidth: `${w}px`, maxWidth: `${w}px` });
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      handle.removeEventListener('pointercancel', up);
      if (w !== start) onResize(id, w);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
    handle.addEventListener('pointercancel', up);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLSpanElement>) => {
    // In RTL the column's end edge is on the left, so ArrowLeft widens (as dragging left would).
    const wider = rtl() ? 'ArrowLeft' : 'ArrowRight';
    const narrower = rtl() ? 'ArrowRight' : 'ArrowLeft';
    let w: number | null | undefined;
    if (e.key === wider || e.key === 'ArrowUp') w = clamp(current() + COLUMN_WIDTH.step);
    else if (e.key === narrower || e.key === 'ArrowDown') w = clamp(current() - COLUMN_WIDTH.step);
    else if (e.key === 'Home') w = null;
    else return;
    e.preventDefault();
    onResize(id, w);
  };

  return (
    <th
      ref={thRef}
      scope="col"
      className={`${className} th-resizable`}
      style={width ? { width, minWidth: width, maxWidth: width } : undefined}
      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}
    >
      <button type="button" className="sort-btn" onClick={() => onSort(next())}>
        {title}
        <span aria-hidden="true" className="sort-ind">
          {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}
        </span>
      </button>
      <span
        role="separator"
        aria-orientation="vertical"
        tabIndex={0}
        className="col-resizer"
        aria-label={`רוחב העמודה ${title}`}
        aria-valuemin={COLUMN_WIDTH.min}
        aria-valuemax={COLUMN_WIDTH.max}
        aria-valuenow={width ?? measured ?? COLUMN_WIDTH.min}
        aria-valuetext={width ? `${width} פיקסלים` : 'ברירת מחדל'}
        title="גרירה או חצים לשינוי רוחב, לחיצה כפולה או Home לאיפוס"
        onPointerDown={onPointerDown}
        onKeyDown={onKeyDown}
        onDoubleClick={() => onResize(id, null)}
      />
    </th>
  );
}

const fmt = (n: number) => new Intl.NumberFormat('he-IL', { maximumFractionDigits: 1 }).format(n);

/** Totals row of a group (top-level items shown): sum / average for numbers, average for progress and rating, count for checkboxes. */
function GroupSummary({ columns, allColumns, items, groupName }: { columns: Column[]; allColumns: Column[]; items: Item[]; groupName: string }) {
  const today = todayIso();
  const cell = (c: Column): string | null => {
    if (c.type === 'formula') {
      const nums = items.map((i) => evaluateFormula(c, i, allColumns, today)).filter((v): v is number => typeof v === 'number');
      if (!nums.length) return null;
      const sum = nums.reduce((a, b) => a + b, 0);
      return `סה"כ ${fmt(sum)} · ממוצע ${fmt(sum / nums.length)}`;
    }
    const vals = items.map((i) => i.values[c.id]);
    if (c.type === 'number' || c.type === 'progress' || c.type === 'rating') {
      const nums = vals.filter((v): v is number => typeof v === 'number');
      if (!nums.length) return null;
      const sum = nums.reduce((a, b) => a + b, 0);
      const avg = sum / nums.length;
      return c.type === 'number' ? `סה"כ ${fmt(sum)} · ממוצע ${fmt(avg)}` : c.type === 'progress' ? `ממוצע ${fmt(avg)}%` : `ממוצע ${fmt(avg)}`;
    }
    if (c.type === 'checkbox') return `${vals.filter((v) => v === true).length} מתוך ${items.length}`;
    return null;
  };
  /** Status columns: how the group's items split between the labels (a "battery"). */
  const battery = (c: Column) => {
    if (c.type !== 'status') return null;
    const parts = (c.settings.options ?? []).map((o) => ({ o, n: items.filter((i) => i.values[c.id] === o.id).length })).filter((p) => p.n > 0);
    const none = items.length - parts.reduce((a, p) => a + p.n, 0);
    if (!parts.length) return null;
    const text = [...parts.map((p) => `${p.o.label} ${p.n}`), ...(none ? [`ללא ${none}`] : [])].join(' · ');
    return (
      <span className="status-battery" role="img" aria-label={`${c.title}: ${text}`} title={text}>
        {parts.map((p) => (
          <span key={p.o.id} style={{ flexGrow: p.n, background: PALETTE[p.o.color]?.bg }} />
        ))}
        {none > 0 && <span className="status-battery-none" style={{ flexGrow: none }} />}
      </span>
    );
  };
  const cells = columns.map(cell);
  const batteries = columns.map(battery);
  if (!items.length || (cells.every((x) => x === null) && batteries.every((x) => x === null))) return null;
  return (
    <tfoot>
      <tr className="summary-row">
        <td className="col-select" />
        <th scope="row" className="col-name">
          סיכום <span className="sr-only">הקבוצה {groupName}</span>
          <span className="muted"> ({items.length} פריטים)</span>
        </th>
        {columns.map((c, i) => (
          <td key={c.id} className="cell summary-cell">
            {batteries[i]}
            {cells[i] && (
              <>
                <span className="sr-only">{c.title}: </span>
                {cells[i]}
              </>
            )}
          </td>
        ))}
      </tr>
    </tfoot>
  );
}

const narrow = (c: Column) => ['checkbox', 'number', 'rating', 'auto_id', 'progress'].includes(c.type);

export function TableView({ board, items, users, onOpenItem, filtered, config, onSort, onResize, selected, onSelect }: Props) {
  const canEdit = board.myRole !== 'viewer';
  const assignable = board.members.map((m) => ({ id: m.userId, name: m.name }));
  const updateItem = useUpdateItem(board.id);
  const { toast } = useFeedback();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  /** Parent whose "+ sub-item" input should take focus (set by the row's + button). */
  const [focusAdd, setFocusAdd] = useState<{ id: string; n: number } | null>(null);
  const today = todayIso();
  const hasDone = doneToggle(board) !== null;
  const hidden = new Set(config.hidden ?? []);
  const columns = board.columns.filter((c) => !hidden.has(c.id));
  // Sub-items of every parent, from the full board (a parent shows its children even when only it matched a filter).
  const childrenOf = (id: string) => sortItems(board.items.filter((i) => i.parentId === id), board.columns, config.sort, users);
  const matchingIds = new Set(items.map((i) => i.id));

  const { setValue, rename } = useUndoableUpdate(board);
  const topOf = (i: Item): string => {
    let cur = i;
    for (let n = 0; n <= MAX_DEPTH && cur.parentId; n++) cur = board.items.find((x) => x.id === cur.parentId) ?? cur;
    return cur.id;
  };
  const withKids = board.items.filter((i) => depthOf(board, i) < MAX_DEPTH && board.items.some((c) => c.parentId === i.id)).map((i) => i.id);
  const allOpen = withKids.length > 0 && withKids.every((id) => expanded[id]);

  const renderRow = (item: Item, color: string) => {
    const overdue = isOverdue(item, board.columns, today);
    const depth = depthOf(board, item);
    const canNest = depth < MAX_DEPTH;
    const kids = canNest ? childrenOf(item.id) : [];
    const isOpen = expanded[item.id] ?? false;
    const prog = canNest ? subtaskProgress(board, item.id) : { done: 0, total: 0 };
    return (
      <tr key={item.id} className={depth > 0 ? 'sub-row' : undefined} style={depth > 0 ? ({ ['--depth' as string]: depth } as React.CSSProperties) : undefined} data-depth={depth}>
        <td className="col-select">
          {canEdit && (
            <input type="checkbox" checked={selected.has(item.id)} aria-label={`בחירת ${item.name}`} onChange={(e) => onSelect([item.id], e.target.checked)} />
          )}
        </td>
        <th scope="row" className="col-name" style={{ fontWeight: 400, ['--group-color' as string]: color }}>
          <div className="name-cell">
            {canNest && (
              <button
                type="button"
                className={`icon-btn subitem-toggle${prog.total > 0 && prog.done === prog.total ? ' all-done' : ''}`}
                aria-expanded={isOpen}
                title={prog.total ? `${prog.done} מתוך ${prog.total} תת-פריטים בוצעו` : 'הוספת תת-פריטים'}
                onClick={() => setExpanded((x) => ({ ...x, [item.id]: !isOpen }))}
              >
                <span style={{ display: 'inline-flex', transform: isOpen ? undefined : 'rotate(90deg)' }} aria-hidden="true">
                  <Icon name="chevronDown" size={16} />
                </span>
                {/* Accessible name = hidden text + the visible count (WCAG 2.5.3). */}
                <span className="sr-only">
                  {isOpen ? 'הסתרת' : 'הצגת'} תת-פריטים של {item.name},{' '}
                </span>
                {prog.total > 0 && hasDone ? (
                  <>
                    <span className="subitem-count num">
                      {prog.done}/{prog.total}
                    </span>
                    <span className="sr-only"> בוצעו</span>
                    <span className="subitem-bar" aria-hidden="true">
                      <span style={{ inlineSize: `${Math.round((prog.done / prog.total) * 100)}%` }} />
                    </span>
                  </>
                ) : (
                  <span className="subitem-count num">{kids.length}</span>
                )}
              </button>
            )}
            {canEdit ? <ItemNameInput item={item} onCommit={(n) => rename(item, n)} /> : <span className="cell-readonly">{item.name}</span>}
            {canEdit && canNest && (
              <button
                type="button"
                className="icon-btn add-sub-btn"
                aria-label={`הוספת תת-פריט ל${item.name}`}
                title="הוספת תת-פריט"
                onClick={() => {
                  setExpanded((x) => ({ ...x, [item.id]: true }));
                  setFocusAdd((f) => ({ id: item.id, n: (f?.n ?? 0) + 1 }));
                }}
              >
                <Icon name="plus" size={16} />
              </button>
            )}
            <button type="button" className="icon-btn" onClick={() => onOpenItem(item.id)} aria-label={`פתיחת ${item.parentId ? 'תת-הפריט' : 'הפריט'} ${item.name}`}>
              <Icon name="open" size={16} />
            </button>
          </div>
        </th>
        {columns.map((c) => (
          <td key={c.id} className={narrow(c) ? 'cell-narrow' : 'cell'}>
            <CellEditor
              column={c}
              value={item.values[c.id]}
              users={users}
              assignable={assignable}
              readOnly={!canEdit}
              label={`${c.title} — ${item.name}`}
              overdue={overdue && c.settings.role === 'due'}
              seq={item.seq}
              createdBy={item.createdBy}
              updatedAt={item.updatedAt}
              columns={board.columns}
              values={item.values}
              linkStat={board.linkStats?.[item.id]}
              itemId={item.id}
              boardId={board.id}
              related={board.relations?.[item.id]?.[c.id]}
              mirrored={board.mirrors?.[item.id]?.[c.id]}
              onChange={(v) => setValue(item, c.id, v)}
              onOpenItem={() => onOpenItem(item.id)}
            />
          </td>
        ))}
      </tr>
    );
  };

  /** A row, then (when expanded) its sub-items recursively and the "+ sub-item" input. */
  const renderTree = (item: Item, color: string, groupId: string, depth: number): React.ReactNode[] => {
    const open = (expanded[item.id] ?? false) && depth < MAX_DEPTH;
    return [
      renderRow(item, color),
      ...(open ? childrenOf(item.id).flatMap((child) => renderTree(child, color, groupId, depth + 1)) : []),
      ...(open && canEdit
        ? [
            <AddRow
              key={`add-${item.id}`}
              boardId={board.id}
              groupId={groupId}
              parentId={item.id}
              colSpan={columns.length}
              label={`תת-פריט חדש ל${item.name}`}
              sub
              depth={depth + 1}
              focus={focusAdd?.id === item.id ? focusAdd.n : 0}
            />,
          ]
        : []),
    ];
  };

  return (
    <>
      {withKids.length > 0 && (
        <div className="toolbar subitems-all">
          <button type="button" className="btn btn-ghost btn-sm" aria-pressed={allOpen} onClick={() => setExpanded(allOpen ? {} : Object.fromEntries(withKids.map((id) => [id, true])))}>
            <Icon name="chevronDown" size={16} /> {allOpen ? 'כיווץ כל תת-הפריטים' : 'הרחבת כל תת-הפריטים'}
          </button>
        </div>
      )}
      {board.groups.map((group) => {
        // Top-level rows: parents that match, plus parents of matching sub-items (to keep context).
        const parentIds = new Set(items.filter((i) => i.parentId).map((i) => topOf(i)));
        const tops = sortItems(
          board.items.filter((i) => !i.parentId && i.groupId === group.id && (matchingIds.has(i.id) || parentIds.has(i.id))),
          board.columns,
          config.sort,
          users,
        );
        const isCollapsed = collapsed[group.id] ?? false;
        const color = PALETTE[group.color]?.bg ?? '#9AA0B4';
        const tableId = `group-table-${group.id}`;
        if (filtered && tops.length === 0) return null;
        // Rows currently on screen, at any depth (for "select all in the group").
        const shownIds = (id: string): string[] => [id, ...(expanded[id] ? childrenOf(id).flatMap((c) => shownIds(c.id)) : [])];
        const groupIds = tops.flatMap((t) => shownIds(t.id));
        const allSelected = groupIds.length > 0 && groupIds.every((id) => selected.has(id));
        return (
          <section key={group.id} className="group-section" aria-label={`קבוצה: ${group.name}`}>
            <div className="group-header">
              <span className="group-color" style={{ background: color }} aria-hidden="true" />
              <button
                type="button"
                className="icon-btn"
                aria-expanded={!isCollapsed}
                aria-controls={tableId}
                aria-label={isCollapsed ? `הצגת הקבוצה ${group.name}` : `כיווץ הקבוצה ${group.name}`}
                onClick={() => setCollapsed((c) => ({ ...c, [group.id]: !isCollapsed }))}
              >
                <span style={{ display: 'inline-flex', transform: isCollapsed ? 'rotate(90deg)' : undefined }}>
                  <Icon name="chevronDown" />
                </span>
              </button>
              <GroupNameInput key={group.name} group={group} boardId={board.id} canEdit={canEdit} />
              <span className="badge">{tops.length}</span>
            </div>
            {!isCollapsed && (
              <div className="table-wrap" id={tableId}>
                <table className="board-table" style={{ ['--group-color' as string]: color }}>
                  <caption className="sr-only">
                    {board.name} — {group.name} ({tops.length} פריטים)
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="col-select">
                        {canEdit && groupIds.length > 0 && (
                          <input type="checkbox" checked={allSelected} aria-label={`בחירת כל הפריטים בקבוצה ${group.name}`} onChange={(e) => onSelect(groupIds, e.target.checked)} />
                        )}
                      </th>
                      <SortHeader id="name" title="פריט" config={config} onSort={onSort} onResize={onResize} className="col-name" />
                      {columns.map((c) => (
                        <SortHeader key={c.id} id={c.id} title={c.title} config={config} onSort={onSort} onResize={onResize} className={narrow(c) ? 'cell-narrow' : 'cell'} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tops.map((item) => renderTree(item, color, group.id, 0))}
                    {tops.length === 0 && (
                      <tr>
                        <td colSpan={columns.length + 2} className="muted" style={{ padding: 'var(--space-3)' }}>
                          אין פריטים בקבוצה זו.
                        </td>
                      </tr>
                    )}
                    {canEdit && <AddRow boardId={board.id} groupId={group.id} colSpan={columns.length} label={`פריט חדש בקבוצה ${group.name}`} />}
                  </tbody>
                  <GroupSummary columns={columns} allColumns={board.columns} items={tops} groupName={group.name} />
                </table>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
