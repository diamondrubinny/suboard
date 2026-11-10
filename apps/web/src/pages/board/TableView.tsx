import { PALETTE, todayIso, isOverdue, type BoardDetail, type CellValue, type Column, type DirectoryUser, type Group, type Item, type ViewConfig } from '@suboard/shared';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { useCreateItem, useGroupMutations, useUpdateItem } from '../../api/hooks';
import { CellEditor } from '../../components/cells/CellEditor';
import { useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
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
function AddRow({ boardId, groupId, parentId, colSpan, label, sub }: { boardId: string; groupId: string; parentId?: string; colSpan: number; label: string; sub?: boolean }) {
  const create = useCreateItem(boardId);
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const submit = () => {
    const n = name.trim();
    if (!n || create.isPending) return;
    create.mutate(
      { groupId, name: n, ...(parentId ? { parentId } : {}) },
      { onSuccess: () => (setName(''), toast(`${sub ? 'תת-הפריט' : 'הפריט'} "${n}" נוסף`)), onError: (e) => toast(errorMessage(e), 'error') },
    );
  };
  return (
    <tr className={sub ? 'add-row sub-row' : 'add-row'}>
      <td className="col-select" />
      <td className="col-name">
        <input
          className="cell-input"
          placeholder={sub ? '+ תת-פריט (Enter לשמירה)' : '+ פריט חדש (Enter לשמירה)'}
          aria-label={label}
          value={name}
          maxLength={300}
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

/** Column header that sorts on click: none → ascending → descending → none (aria-sort reflects it). */
function SortHeader({ id, title, config, onSort, className }: { id: string; title: string; config: ViewConfig; onSort: Props['onSort']; className: string }) {
  const dir = config.sort?.by === id ? config.sort.dir : undefined;
  const next = (): ViewConfig['sort'] => (!dir ? { by: id as never, dir: 'asc' } : dir === 'asc' ? { by: id as never, dir: 'desc' } : undefined);
  return (
    <th scope="col" className={className} aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : 'none'}>
      <button type="button" className="sort-btn" onClick={() => onSort(next())}>
        {title}
        <span aria-hidden="true" className="sort-ind">
          {dir === 'asc' ? '▲' : dir === 'desc' ? '▼' : '↕'}
        </span>
      </button>
    </th>
  );
}

const narrow = (c: Column) => ['checkbox', 'number', 'rating', 'auto_id', 'progress'].includes(c.type);

export function TableView({ board, items, users, onOpenItem, filtered, config, onSort, selected, onSelect }: Props) {
  const canEdit = board.myRole !== 'viewer';
  const assignable = board.members.map((m) => ({ id: m.userId, name: m.name }));
  const updateItem = useUpdateItem(board.id);
  const { toast } = useFeedback();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const today = todayIso();
  const hidden = new Set(config.hidden ?? []);
  const columns = board.columns.filter((c) => !hidden.has(c.id));
  // Sub-items of every parent, from the full board (a parent shows its children even when only it matched a filter).
  const childrenOf = (id: string) => sortItems(board.items.filter((i) => i.parentId === id), board.columns, config.sort, users);
  const matchingIds = new Set(items.map((i) => i.id));

  const setValue = (item: Item, columnId: string, value: CellValue) =>
    updateItem.mutate({ itemId: item.id, patch: { values: { [columnId]: value } } }, { onError: (e) => toast(errorMessage(e), 'error') });
  const rename = (item: Item, name: string) => updateItem.mutate({ itemId: item.id, patch: { name } }, { onError: (e) => toast(errorMessage(e), 'error') });

  const renderRow = (item: Item, color: string) => {
    const overdue = isOverdue(item, board.columns, today);
    const kids = item.parentId ? [] : childrenOf(item.id);
    const isOpen = expanded[item.id] ?? false;
    return (
      <tr key={item.id} className={item.parentId ? 'sub-row' : undefined}>
        <td className="col-select">
          {canEdit && (
            <input type="checkbox" checked={selected.has(item.id)} aria-label={`בחירת ${item.name}`} onChange={(e) => onSelect([item.id], e.target.checked)} />
          )}
        </td>
        <th scope="row" className="col-name" style={{ fontWeight: 400, ['--group-color' as string]: color }}>
          <div className="name-cell">
            {!item.parentId && (
              <button type="button" className="icon-btn subitem-toggle" aria-expanded={isOpen} onClick={() => setExpanded((x) => ({ ...x, [item.id]: !isOpen }))}>
                <span style={{ display: 'inline-flex', transform: isOpen ? undefined : 'rotate(90deg)' }} aria-hidden="true">
                  <Icon name="chevronDown" size={16} />
                </span>
                {/* Accessible name = hidden text + the visible count (WCAG 2.5.3). */}
                <span className="sr-only">
                  {isOpen ? 'הסתרת' : 'הצגת'} תת-פריטים של {item.name},{' '}
                </span>
                <span className="subitem-count num">{kids.length}</span>
              </button>
            )}
            {canEdit ? <ItemNameInput item={item} onCommit={(n) => rename(item, n)} /> : <span className="cell-readonly">{item.name}</span>}
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
              onChange={(v) => setValue(item, c.id, v)}
              onOpenItem={() => onOpenItem(item.id)}
            />
          </td>
        ))}
      </tr>
    );
  };

  return (
    <>
      {board.groups.map((group) => {
        // Top-level rows: parents that match, plus parents of matching sub-items (to keep context).
        const parentIds = new Set(items.filter((i) => i.parentId).map((i) => i.parentId!));
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
        const groupIds = tops.flatMap((t) => [t.id, ...(expanded[t.id] ? childrenOf(t.id).map((c) => c.id) : [])]);
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
                      <SortHeader id="name" title="פריט" config={config} onSort={onSort} className="col-name" />
                      {columns.map((c) => (
                        <SortHeader key={c.id} id={c.id} title={c.title} config={config} onSort={onSort} className={narrow(c) ? 'cell-narrow' : 'cell'} />
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tops.map((item) => {
                      const open = expanded[item.id] ?? false;
                      return [
                        renderRow(item, color),
                        ...(open ? childrenOf(item.id).map((child) => renderRow(child, color)) : []),
                        ...(open && canEdit
                          ? [<AddRow key={`add-${item.id}`} boardId={board.id} groupId={group.id} parentId={item.id} colSpan={columns.length} label={`תת-פריט חדש ל${item.name}`} sub />]
                          : []),
                      ];
                    })}
                    {tops.length === 0 && (
                      <tr>
                        <td colSpan={columns.length + 2} className="muted" style={{ padding: 'var(--space-3)' }}>
                          אין פריטים בקבוצה זו.
                        </td>
                      </tr>
                    )}
                    {canEdit && <AddRow boardId={board.id} groupId={group.id} colSpan={columns.length} label={`פריט חדש בקבוצה ${group.name}`} />}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
