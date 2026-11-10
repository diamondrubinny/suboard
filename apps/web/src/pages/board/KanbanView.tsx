import { findDueColumn, formatDateHe, isOverdue, PALETTE, todayIso, type BoardDetail, type DirectoryUser, type Item } from '@suboard/shared';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { useUpdateItem } from '../../api/hooks';
import { personNames } from '../../components/cells/PersonPicker';
import { EmptyState, useFeedback } from '../../components/Feedback';

interface Props {
  board: BoardDetail;
  items: Item[];
  users: DirectoryUser[];
  onOpenItem: (itemId: string) => void;
  /** Status column to group by (part of the saved view). */
  columnId?: string;
  onColumnChange: (id: string) => void;
}

const NONE = '__none__';

/**
 * Kanban grouped by a status column. Drag-and-drop for pointer users, plus a
 * per-card select as the keyboard / screen-reader alternative (WCAG 2.1.1, 2.5.7).
 */
export function KanbanView({ board, items, users, onOpenItem, columnId, onColumnChange }: Props) {
  const statusColumns = board.columns.filter((c) => c.type === 'status');
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const update = useUpdateItem(board.id);
  const { toast } = useFeedback();
  const canEdit = board.myRole !== 'viewer';
  const today = todayIso();

  const column = statusColumns.find((c) => c.id === columnId) ?? statusColumns[0];
  if (!column) return <EmptyState title="אין בלוח עמודת סטטוס">הוסיפו עמודת סטטוס בהגדרות הלוח כדי להשתמש בתצוגת קנבן.</EmptyState>;

  const dueCol = findDueColumn(board.columns);
  const personCols = board.columns.filter((c) => c.type === 'person');
  const options = column.settings.options ?? [];
  // Lane header = full fill in the status colour with its paired text colour (design system: Kanban).
  const lanes = [
    ...options.map((o) => ({ id: o.id, label: o.label, color: PALETTE[o.color].bg, fg: PALETTE[o.color].fg })),
    { id: NONE, label: 'ללא ערך', color: 'var(--surface-sunken)', fg: 'var(--ink)' },
  ];

  const move = (item: Item, laneId: string) => {
    const value = laneId === NONE ? null : laneId;
    if ((item.values[column.id] ?? null) === value) return;
    const label = lanes.find((l) => l.id === laneId)?.label;
    update.mutate(
      { itemId: item.id, patch: { values: { [column.id]: value } } },
      { onSuccess: () => toast(`"${item.name}" הועבר ל"${label}"`), onError: (e) => toast(errorMessage(e), 'error') },
    );
  };

  return (
    <>
      {statusColumns.length > 1 && (
        <div className="toolbar">
          <label htmlFor="kanban-col">קיבוץ לפי</label>
          <select id="kanban-col" className="select" value={column.id} onChange={(e) => onColumnChange(e.target.value)}>
            {statusColumns.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="kanban">
        {lanes.map((lane) => {
          const laneItems = items.filter((i) => {
            const v = i.values[column.id];
            return lane.id === NONE ? typeof v !== 'string' || !options.some((o) => o.id === v) : v === lane.id;
          });
          if (lane.id === NONE && laneItems.length === 0) return null;
          return (
            <section
              key={lane.id}
              className="kanban-col"
              aria-label={`${lane.label} (${laneItems.length})`}
              style={{ ['--col-color' as string]: lane.color, ['--col-fg' as string]: lane.fg }}
              data-drop={dropTarget === lane.id}
              onDragOver={(e) => {
                if (!canEdit || !dragId) return;
                e.preventDefault();
                setDropTarget(lane.id);
              }}
              onDragLeave={() => setDropTarget((t) => (t === lane.id ? null : t))}
              onDrop={(e) => {
                e.preventDefault();
                const item = items.find((i) => i.id === dragId);
                if (item) move(item, lane.id);
                setDragId(null);
                setDropTarget(null);
              }}
            >
              <h2>
                <span>{lane.label}</span>
                <span className="badge">{laneItems.length}</span>
              </h2>
              <ul className="list-plain">
                {laneItems.map((item) => {
                  const due = dueCol ? item.values[dueCol.id] : undefined;
                  const people = personCols.flatMap((c) => (Array.isArray(item.values[c.id]) ? (item.values[c.id] as string[]) : []));
                  const overdue = isOverdue(item, board.columns, today);
                  return (
                    <li
                      key={item.id}
                      className="kanban-card"
                      draggable={canEdit}
                      data-dragging={dragId === item.id}
                      onDragStart={(e) => {
                        setDragId(item.id);
                        e.dataTransfer.effectAllowed = 'move';
                        e.dataTransfer.setData('text/plain', item.id);
                      }}
                      onDragEnd={() => {
                        setDragId(null);
                        setDropTarget(null);
                      }}
                    >
                      <button type="button" className="title-btn" onClick={() => onOpenItem(item.id)}>
                        {item.name}
                      </button>
                      <div className="meta">
                        {typeof due === 'string' && (
                          <span className={overdue ? 'badge danger' : 'badge'}>
                            {overdue && <span className="sr-only">באיחור, </span>}
                            {formatDateHe(due)}
                          </span>
                        )}
                        {people.length > 0 && <span>{personNames([...new Set(people)], users)}</span>}
                      </div>
                      {canEdit && (
                        <select
                          className="select"
                          style={{ minHeight: '2rem', fontSize: '0.85rem' }}
                          aria-label={`העברת "${item.name}" לעמודה`}
                          value={lane.id}
                          onChange={(e) => move(item, e.target.value)}
                        >
                          {lanes.map((l) => (
                            <option key={l.id} value={l.id}>
                              {l.label}
                            </option>
                          ))}
                        </select>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}
      </div>
    </>
  );
}
