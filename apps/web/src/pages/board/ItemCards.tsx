import { canEditColumn, findDueColumn, findPrimaryStatusColumn, formatDateHe, isOverdue, todayIso, type BoardDetail, type DirectoryUser, type Item } from '@suboard/shared';
import { useEffect, useState } from 'react';
import { errorMessage } from '../../api/client';
import { useCreateItem, useTeams, useUpdateItem } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { personNames } from '../../components/cells/PersonPicker';
import { useFeedback } from '../../components/Feedback';
import { colorStyle } from '../../components/StatusPill';
import { subtaskProgress } from './subtasks';

const PHONE = '(max-width: 700px)';
const KEY = 'suboard.phoneTable';

/** True on a narrow screen (follows rotation / resizing). */
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/** On a phone the items are cards unless the person asked for the full table (remembered per browser). */
export function usePhoneTablePreference(): [boolean, (v: boolean) => void] {
  const [table, setTable] = useState(() => {
    try {
      return localStorage.getItem(KEY) === '1';
    } catch {
      return false;
    }
  });
  return [
    table,
    (v) => {
      setTable(v);
      try {
        localStorage.setItem(KEY, v ? '1' : '0');
      } catch {
        /* private mode: the choice lasts for this visit only */
      }
    },
  ];
}

/**
 * The items of one group as cards, for narrow screens: the name opens the item, the main status
 * can be changed in place, and the due date, the people and the sub-item progress are shown as
 * text. Everything else is edited in the item window, which fits a phone better than table cells.
 */
export function ItemCards({ board, items, users, groupId, groupName, canAdd, onOpenItem, id, color }: { board: BoardDetail; items: Item[]; users: DirectoryUser[]; groupId: string; groupName: string; canAdd: boolean; onOpenItem: (itemId: string) => void; id: string; color?: string }) {
  const status = findPrimaryStatusColumn(board.columns);
  const due = findDueColumn(board.columns);
  const people = board.columns.filter((c) => c.type === 'person');
  // Teams are "who handles it" too. Guests cannot read the list of teams, so they see none here.
  const teamCols = board.columns.filter((c) => c.type === 'team');
  const { user } = useAuth();
  const teams = useTeams(Boolean(user) && !user!.guest && teamCols.length > 0);
  const teamList = (teams.data ?? []).map((t) => ({ id: t.id, name: t.name }));
  const today = todayIso();
  const update = useUpdateItem(board.id);
  const { toast } = useFeedback();
  const mayStatus = Boolean(status) && canEditColumn(status!, board.myRole);
  return (
    <div id={id} className="item-cards" style={color ? ({ ['--group-color' as string]: color } as React.CSSProperties) : undefined}>
      {items.length === 0 && <p className="muted item-cards-empty">אין פריטים בקבוצה זו.</p>}
      <ul className="list-plain">
        {items.map((item) => {
          const value = status ? item.values[status.id] : undefined;
          const option = status?.settings.options?.find((o) => o.id === value);
          const dueValue = due ? item.values[due.id] : undefined;
          const late = isOverdue(item, board.columns, today);
          const names = personNames([...new Set(people.flatMap((c) => (Array.isArray(item.values[c.id]) ? (item.values[c.id] as string[]) : [])))], users);
          const teamNames = personNames([...new Set(teamCols.flatMap((c) => (Array.isArray(item.values[c.id]) ? (item.values[c.id] as string[]) : [])))].filter((id) => teamList.some((t) => t.id === id)), teamList);
          const prog = subtaskProgress(board, item.id);
          return (
            <li key={item.id} className="item-card">
              <button type="button" className="item-card-name" onClick={() => onOpenItem(item.id)} aria-label={`פתיחת הפריט ${item.name}`}>
                {item.name}
              </button>
              <div className="item-card-meta">
                {status &&
                  (mayStatus ? (
                    <select
                      className="item-card-status"
                      style={colorStyle(option?.color)}
                      value={typeof value === 'string' && option ? value : ''}
                      aria-label={`${status.title} — ${item.name}`}
                      onChange={(e) => update.mutate({ itemId: item.id, patch: { values: { [status.id]: e.target.value || null } } }, { onError: (err) => toast(errorMessage(err), 'error') })}
                    >
                      <option value="">— {status.title} —</option>
                      {(status.settings.options ?? [])
                        .filter((o) => !o.inactive || o.id === value)
                        .map((o) => (
                          <option key={o.id} value={o.id}>
                            {o.label}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <span className="pill" style={colorStyle(option?.color)}>
                      {option?.label ?? '—'}
                    </span>
                  ))}
                {typeof dueValue === 'string' && dueValue && (
                  <span className={late ? 'item-card-due overdue' : 'item-card-due'}>
                    <span className="sr-only">{due!.title}: </span>
                    <span className="num">{formatDateHe(dueValue)}</span>
                    {late && <span> · באיחור</span>}
                  </span>
                )}
                {names && <span className="item-card-people">{names}</span>}
                {teamNames && <span className="item-card-people">{teamNames}</span>}
                {prog.total > 0 && (
                  <span className="muted num">
                    {prog.done}/{prog.total} תת-פריטים
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {canAdd && <AddCard boardId={board.id} groupId={groupId} label={`פריט חדש בקבוצה ${groupName}`} term={board.itemTerm} />}
    </div>
  );
}

function AddCard({ boardId, groupId, label, term }: { boardId: string; groupId: string; label: string; term?: string | null }) {
  const create = useCreateItem(boardId);
  const { toast } = useFeedback();
  const [name, setName] = useState('');
  const submit = () => {
    const n = name.trim();
    if (!n || create.isPending) return;
    create.mutate({ groupId, name: n }, { onSuccess: () => (setName(''), toast(`הפריט "${n}" נוסף`)), onError: (e) => toast(errorMessage(e), 'error') });
  };
  return (
    <form
      className="item-card-add"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <input className="input" placeholder={term ? `+ הוספת ${term}` : '+ פריט חדש'} aria-label={label} value={name} maxLength={300} disabled={create.isPending} onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="btn" disabled={create.isPending || !name.trim()}>
        הוספה
      </button>
    </form>
  );
}
