import { PALETTE, todayIso, isOverdue, type BoardDetail, type CellValue, type DirectoryUser, type Group, type Item } from '@suboard/shared';
import { useState } from 'react';
import { errorMessage } from '../../api/client';
import { useCreateItem, useGroupMutations, useUpdateItem } from '../../api/hooks';
import { CellEditor } from '../../components/cells/CellEditor';
import { useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';

interface Props {
  board: BoardDetail;
  items: Item[];
  users: DirectoryUser[];
  onOpenItem: (itemId: string) => void;
  filtered: boolean;
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
        className="cell-input"
        style={{ fontWeight: 700, fontSize: '1.05rem', minWidth: '14rem' }}
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

function AddItemRow({ boardId, groupId, colSpan, groupName }: { boardId: string; groupId: string; colSpan: number; groupName: string }) {
  const create = useCreateItem(boardId);
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const submit = () => {
    const n = name.trim();
    if (!n || create.isPending) return;
    create.mutate(
      { groupId, name: n },
      {
        onSuccess: () => {
          setName('');
          toast(`הפריט "${n}" נוסף`);
        },
        onError: (e) => toast(errorMessage(e), 'error'),
      },
    );
  };
  return (
    <tr className="add-row">
      <td className="col-name">
        <input
          className="cell-input"
          placeholder="+ פריט חדש (Enter לשמירה)"
          aria-label={`פריט חדש בקבוצה ${groupName}`}
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

export function TableView({ board, items, users, onOpenItem, filtered }: Props) {
  const canEdit = board.myRole !== 'viewer';
  const updateItem = useUpdateItem(board.id);
  const { toast } = useFeedback();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const today = todayIso();

  const setValue = (item: Item, columnId: string, value: CellValue) =>
    updateItem.mutate({ itemId: item.id, patch: { values: { [columnId]: value } } }, { onError: (e) => toast(errorMessage(e), 'error') });
  const rename = (item: Item, name: string) =>
    updateItem.mutate({ itemId: item.id, patch: { name } }, { onError: (e) => toast(errorMessage(e), 'error') });

  return (
    <>
      {board.groups.map((group) => {
        const groupItems = items.filter((i) => i.groupId === group.id).sort((a, b) => a.position - b.position);
        const isCollapsed = collapsed[group.id] ?? false;
        const color = PALETTE[group.color]?.bg ?? '#5B6472';
        const tableId = `group-table-${group.id}`;
        if (filtered && groupItems.length === 0) return null;
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
              <span className="badge">{groupItems.length}</span>
            </div>
            {!isCollapsed && (
              <div className="table-wrap" id={tableId}>
                <table className="board-table" style={{ ['--group-color' as string]: color }}>
                  <caption className="sr-only">
                    {board.name} — {group.name} ({groupItems.length} פריטים)
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col" className="col-name">
                        פריט
                      </th>
                      {board.columns.map((c) => (
                        <th key={c.id} scope="col" className={c.type === 'checkbox' || c.type === 'number' ? 'cell-narrow' : 'cell'}>
                          {c.title}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groupItems.map((item) => {
                      const overdue = isOverdue(item, board.columns, today);
                      return (
                        <tr key={item.id}>
                          <th scope="row" className="col-name" style={{ fontWeight: 400 }}>
                            <div className="name-cell">
                              {canEdit ? (
                                <ItemNameInput item={item} onCommit={(n) => rename(item, n)} />
                              ) : (
                                <span className="cell-readonly">{item.name}</span>
                              )}
                              <button type="button" className="icon-btn" onClick={() => onOpenItem(item.id)} aria-label={`פתיחת הפריט ${item.name}`}>
                                <Icon name="open" size={16} />
                              </button>
                            </div>
                          </th>
                          {board.columns.map((c) => (
                            <td key={c.id} className={c.type === 'checkbox' || c.type === 'number' ? 'cell-narrow' : 'cell'}>
                              <CellEditor
                                column={c}
                                value={item.values[c.id]}
                                users={users}
                                readOnly={!canEdit}
                                label={`${c.title} — ${item.name}`}
                                overdue={overdue && c.settings.role === 'due'}
                                onChange={(v) => setValue(item, c.id, v)}
                                onOpenItem={() => onOpenItem(item.id)}
                              />
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    {groupItems.length === 0 && (
                      <tr>
                        <td colSpan={board.columns.length + 1} className="muted" style={{ padding: '0.75rem' }}>
                          אין פריטים בקבוצה זו.
                        </td>
                      </tr>
                    )}
                    {canEdit && <AddItemRow boardId={board.id} groupId={group.id} groupName={group.name} colSpan={board.columns.length} />}
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
      aria-label={`שם הפריט: ${item.name}`}
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
