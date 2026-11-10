import { BOARD_ROLE_LABELS, findPrimaryStatusColumn, type Item } from '@suboard/shared';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client';
import { useBoard, useDirectory, useGroupMutations } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { usePageTitle } from '../../components/Layout';
import { NotFoundPage } from '../NotFoundPage';
import { ItemDrawer } from './ItemDrawer';
import { KanbanView } from './KanbanView';
import { TableView } from './TableView';

type View = 'table' | 'kanban';
const VIEW_KEY = 'suboard.view';

function readView(boardId: string): View {
  try {
    return (localStorage.getItem(`${VIEW_KEY}.${boardId}`) as View) === 'kanban' ? 'kanban' : 'table';
  } catch {
    return 'table';
  }
}

export function BoardPage() {
  const { boardId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();
  const board = useBoard(boardId);
  const directory = useDirectory();
  const groups = useGroupMutations(boardId);
  const { toast } = useFeedback();
  const [view, setView] = useState<View>(() => readView(boardId));
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [newGroup, setNewGroup] = useState('');
  usePageTitle(board.data?.name ?? 'לוח');

  const openItemId = params.get('item');
  const openItem = (id: string) => setParams((p) => (p.set('item', id), p));
  const closeItem = () => setParams((p) => (p.delete('item'), p));

  const changeView = (v: View) => {
    setView(v);
    try {
      localStorage.setItem(`${VIEW_KEY}.${boardId}`, v);
    } catch {
      /* ignore */
    }
  };

  const filteredItems = useMemo<Item[]>(() => {
    const b = board.data;
    if (!b) return [];
    const q = search.trim().toLowerCase();
    const textCols = b.columns.filter((c) => c.type === 'text' || c.type === 'long_text');
    const personCols = b.columns.filter((c) => c.type === 'person');
    const statusCol = findPrimaryStatusColumn(b.columns);
    return b.items.filter((i) => {
      if (q && !i.name.toLowerCase().includes(q) && !textCols.some((c) => String(i.values[c.id] ?? '').toLowerCase().includes(q))) return false;
      if (mine && !personCols.some((c) => Array.isArray(i.values[c.id]) && (i.values[c.id] as string[]).includes(user?.id ?? ''))) return false;
      if (statusFilter && statusCol && i.values[statusCol.id] !== statusFilter) return false;
      return true;
    });
  }, [board.data, search, mine, statusFilter, user?.id]);

  if (board.isPending) return <LoadingState label="טוען לוח…" />;
  if (board.isError) {
    if (board.error instanceof ApiError && (board.error.status === 404 || board.error.status === 400)) return <NotFoundPage />;
    return <ErrorState message={errorMessage(board.error)} onRetry={() => board.refetch()} />;
  }
  const b = board.data;
  const users = directory.data ?? [];
  const canEdit = b.myRole !== 'viewer';
  const statusCol = findPrimaryStatusColumn(b.columns);
  const isFiltered = Boolean(search.trim() || mine || statusFilter);

  const addGroup = (e: FormEvent) => {
    e.preventDefault();
    const name = newGroup.trim();
    if (!name) return;
    groups.create.mutate(
      { name },
      { onSuccess: () => (setNewGroup(''), toast(`הקבוצה "${name}" נוספה`)), onError: (err) => toast(errorMessage(err), 'error') },
    );
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{b.name}</h1>
          {b.description && <p className="muted" style={{ margin: '0.25rem 0 0' }}>{b.description}</p>}
        </div>
        <div className="actions">
          <span className="badge" title="ההרשאה שלך בלוח">
            {BOARD_ROLE_LABELS[b.myRole]}
          </span>
          <a href={`/api/boards/${b.id}/export.csv`} className="btn" download>
            <Icon name="download" /> ייצוא ל-CSV
          </a>
          {b.myRole === 'owner' && (
            <Link to={`/boards/${b.id}/settings`} className="btn">
              <Icon name="gear" /> הגדרות לוח
            </Link>
          )}
        </div>
      </div>

      <div className="toolbar" role="search" aria-label="סינון פריטים">
        <div className="segmented" role="group" aria-label="תצוגה">
          <button type="button" aria-pressed={view === 'table'} onClick={() => changeView('table')}>
            <Icon name="table" /> טבלה
          </button>
          <button type="button" aria-pressed={view === 'kanban'} onClick={() => changeView('kanban')}>
            <Icon name="kanban" /> קנבן
          </button>
        </div>
        <label htmlFor="board-search" className="sr-only">
          חיפוש בלוח
        </label>
        <input id="board-search" type="search" className="input" placeholder="חיפוש…" value={search} onChange={(e) => setSearch(e.target.value)} />
        {statusCol && (
          <>
            <label htmlFor="status-filter" className="sr-only">
              סינון לפי {statusCol.title}
            </label>
            <select id="status-filter" className="select" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
              <option value="">כל ה{statusCol.title === 'סטטוס' ? 'סטטוסים' : `ערכים (${statusCol.title})`}</option>
              {statusCol.settings.options?.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </>
        )}
        <label className="checkbox-row">
          <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
          רק פריטים שלי
        </label>
        {isFiltered && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => (setSearch(''), setMine(false), setStatusFilter(''))}>
            ניקוי סינון
          </button>
        )}
        <span className="muted" role="status" aria-live="polite" style={{ marginInlineStart: 'auto' }}>
          {isFiltered ? `${filteredItems.length} מתוך ${b.items.length} פריטים` : `${b.items.length} פריטים`}
        </span>
      </div>

      {view === 'table' ? (
        <TableView board={b} items={filteredItems} users={users} onOpenItem={openItem} filtered={isFiltered} />
      ) : (
        <KanbanView board={b} items={filteredItems} users={users} onOpenItem={openItem} />
      )}

      {isFiltered && filteredItems.length === 0 && <p className="muted">לא נמצאו פריטים התואמים לסינון.</p>}

      {canEdit && view === 'table' && (
        <form onSubmit={addGroup} className="toolbar" style={{ marginTop: '0.5rem' }}>
          <label htmlFor="new-group" className="sr-only">
            שם קבוצה חדשה
          </label>
          <input id="new-group" className="input" placeholder="שם קבוצה חדשה" maxLength={80} value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
          <button type="submit" className="btn" disabled={groups.create.isPending || !newGroup.trim()}>
            <Icon name="plus" /> הוספת קבוצה
          </button>
        </form>
      )}

      <ItemDrawer key={openItemId ?? 'none'} board={b} itemId={openItemId} users={users} onClose={closeItem} />
    </>
  );
}
