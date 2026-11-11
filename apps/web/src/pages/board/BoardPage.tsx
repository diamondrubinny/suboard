import { apiUrl } from '../../api/base';
import { BOARD_ROLE_LABELS, findPrimaryStatusColumn, viewConfigSchema, type SavedView, type ViewConfig } from '@suboard/shared';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client';
import { useBoard, useDirectory, useGroupMutations } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { usePageTitle } from '../../components/Layout';
import { FavoriteButton } from '../../components/FavoriteButton';
import { NotFoundPage } from '../NotFoundPage';
import { BulkBar, ColumnsMenu, ImportDialog, TrashDialog, ViewsMenu } from './BoardTools';
import { RiskMatrixView } from './RiskMatrixView';
import { GanttView } from './GanttView';
import { CalendarView } from './CalendarView';
import { ItemDrawer } from './ItemDrawer';
import { NewFromTemplate } from './PersonalPanel';
import { KanbanView } from './KanbanView';
import { TableView } from './TableView';
import { filterItems } from './viewLogic';

const VIEW_KEY = 'suboard.view';
type ViewKind = ViewConfig['view'];

function readView(boardId: string): ViewKind {
  try {
    const v = localStorage.getItem(`${VIEW_KEY}.${boardId}`);
    return v === 'kanban' || v === 'calendar' || v === 'risk' || v === 'gantt' ? v : 'table';
  } catch {
    return 'table';
  }
}

const WIDTHS_KEY = 'suboard.widths';
/** Personal column widths per board (a display preference; kept in this browser only). */
function readWidths(boardId: string): ViewConfig['widths'] {
  try {
    const parsed = viewConfigSchema.shape.widths.safeParse(JSON.parse(localStorage.getItem(`${WIDTHS_KEY}.${boardId}`) ?? 'null') ?? undefined);
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
function writeWidths(boardId: string, widths: ViewConfig['widths']) {
  try {
    if (widths && Object.keys(widths).length) localStorage.setItem(`${WIDTHS_KEY}.${boardId}`, JSON.stringify(widths));
    else localStorage.removeItem(`${WIDTHS_KEY}.${boardId}`);
  } catch {
    /* storage unavailable: widths last for this visit only */
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
  const [config, setConfig] = useState<ViewConfig>(() => ({ view: readView(boardId), widths: readWidths(boardId) }));
  const [activeView, setActiveView] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newGroup, setNewGroup] = useState('');
  const [dialog, setDialog] = useState<'trash' | 'import' | null>(null);
  usePageTitle(board.data?.name ?? 'לוח');

  const openItemId = params.get('item');
  const openItem = (id: string) => setParams((p) => (p.set('item', id), p));
  const closeItem = () => setParams((p) => (p.delete('item'), p));

  const patch = (p: Partial<ViewConfig>) => setConfig((c) => ({ ...c, ...p }));
  const changeView = (view: ViewKind) => {
    patch({ view });
    setSelected(new Set());
    try {
      localStorage.setItem(`${VIEW_KEY}.${boardId}`, view);
    } catch {
      /* ignore */
    }
  };
  const applyView = (v: SavedView | null) => {
    setActiveView(v?.id ?? null);
    setConfig(v ? { ...v.config, widths: v.config.widths ?? readWidths(boardId) } : { view: readView(boardId), widths: readWidths(boardId) });
    setSelected(new Set());
  };
  const onSelect = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      ids.forEach((id) => (on ? n.add(id) : n.delete(id)));
      return n;
    });

  const filteredItems = useMemo(() => (board.data ? filterItems(board.data, config, user?.id) : []), [board.data, config, user?.id]);

  if (board.isPending) return <LoadingState label="טוען לוח…" />;
  if (board.isError) {
    if (board.error instanceof ApiError && (board.error.status === 404 || board.error.status === 400)) return <NotFoundPage />;
    return <ErrorState message={errorMessage(board.error)} onRetry={() => board.refetch()} />;
  }
  const b = board.data;
  const users = directory.data ?? [];
  const canEdit = b.myRole !== 'viewer';
  const statusCol = findPrimaryStatusColumn(b.columns);
  const isFiltered = Boolean(config.search?.trim() || config.mine || config.statusFilter);
  const topCount = b.items.filter((i) => !i.parentId).length;
  const shownCount = filteredItems.filter((i) => !i.parentId).length;
  const members = b.members.map((m) => ({ id: m.userId, name: m.name }));

  const addGroup = (e: FormEvent) => {
    e.preventDefault();
    const name = newGroup.trim();
    if (!name) return;
    groups.create.mutate({ name }, { onSuccess: () => (setNewGroup(''), toast(`הקבוצה "${name}" נוספה`)), onError: (err) => toast(errorMessage(err), 'error') });
  };

  return (
    <>
      <div className="page-header">
        <div>
          <div className="title-row">
            <h1>{b.name}</h1>
            <FavoriteButton boardId={b.id} boardName={b.name} favorite={b.favorite} />
          </div>
          {b.description && <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>{b.description}</p>}
        </div>
        <div className="actions">
          <span className="badge" title="ההרשאה שלך בלוח">
            {BOARD_ROLE_LABELS[b.myRole]}
          </span>
          <a href={apiUrl(`/boards/${b.id}/export.xlsx`)} className="btn" download>
            <Icon name="download" /> Excel
          </a>
          <a href={apiUrl(`/boards/${b.id}/export.csv`)} className="btn btn-ghost" download>
            CSV
          </a>
          {b.columns.some((c) => c.type === 'date' || c.type === 'date_range') && (
            <a href={apiUrl(`/boards/${b.id}/calendar.ics${config.calendarColumnId ? `?columnId=${config.calendarColumnId}` : ''}`)} className="btn btn-ghost" download>
              <Icon name="calendar" /> ליומן (ICS)
            </a>
          )}
          <button type="button" className="btn btn-ghost" onClick={() => window.print()}>
            <Icon name="printer" /> PDF
          </button>
          <Link to={`/boards/${b.id}/report`} className="btn btn-ghost">
            <Icon name="chart" /> סיכום
          </Link>
          {b.templateKey === 'hazards' && (
            <Link to={`/boards/${b.id}/plans`} className="btn btn-ghost">
              <Icon name="grid" /> תוכניות קומה
            </Link>
          )}
          <Link to={`/boards/${b.id}/files`} className="btn btn-ghost">
            <Icon name="image" /> גלריית קבצים
          </Link>
          <Link to={`/boards/${b.id}/qr`} className="btn btn-ghost">
            <Icon name="grid" /> מדבקות QR
          </Link>
          <NewFromTemplate board={b} onCreated={openItem} />
          {b.myRole === 'owner' && (
            <Link to={`/boards/${b.id}/forms`} className="btn">
              <Icon name="clipboard" /> טפסים
            </Link>
          )}
          <Link to={`/boards/${b.id}/automations`} className="btn">
            <Icon name="bolt" /> אוטומציות
          </Link>
          {canEdit && (
            <>
              <button type="button" className="btn" onClick={() => setDialog('import')}>
                ייבוא
              </button>
              <button type="button" className="btn" onClick={() => setDialog('trash')}>
                <Icon name="trash" /> סל מחזור
              </button>
            </>
          )}
          {b.myRole === 'owner' && (
            <Link to={`/boards/${b.id}/settings`} className="btn">
              <Icon name="gear" /> הגדרות לוח
            </Link>
          )}
        </div>
      </div>

      <div className="toolbar" role="group" aria-label="תצוגות שמורות">
        <ViewsMenu board={b} config={config} activeId={activeView} onApply={applyView} />
      </div>

      <div className="toolbar" role="search" aria-label="סינון פריטים">
        <div className="segmented" role="group" aria-label="תצוגה">
          <button type="button" aria-pressed={config.view === 'table'} onClick={() => changeView('table')}>
            <Icon name="table" /> טבלה
          </button>
          <button type="button" aria-pressed={config.view === 'kanban'} onClick={() => changeView('kanban')}>
            <Icon name="kanban" /> קנבן
          </button>
          <button type="button" aria-pressed={config.view === 'calendar'} onClick={() => changeView('calendar')}>
            <Icon name="history" /> לוח שנה
          </button>
          {b.columns.some((c) => c.type === 'date_range' || c.type === 'date') && (
            <button type="button" aria-pressed={config.view === 'gantt'} onClick={() => changeView('gantt')}>
              <Icon name="chart" /> ציר זמן
            </button>
          )}
          {b.columns.some((c) => c.type === 'risk') && (
            <button type="button" aria-pressed={config.view === 'risk'} onClick={() => changeView('risk')}>
              <Icon name="grid" /> מפת סיכונים
            </button>
          )}
        </div>
        <label htmlFor="board-search" className="sr-only">
          חיפוש בלוח
        </label>
        <input id="board-search" type="search" className="input" placeholder="חיפוש בלוח…" value={config.search ?? ''} onChange={(e) => patch({ search: e.target.value })} />
        {statusCol && (
          <>
            <label htmlFor="status-filter" className="sr-only">
              סינון לפי {statusCol.title}
            </label>
            <select id="status-filter" className="select" value={config.statusFilter ?? ''} onChange={(e) => patch({ statusFilter: e.target.value || undefined })}>
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
          <input type="checkbox" checked={Boolean(config.mine)} onChange={(e) => patch({ mine: e.target.checked || undefined })} />
          רק פריטים שלי
        </label>
        {config.view === 'table' && <ColumnsMenu board={b} hidden={config.hidden ?? []} onChange={(hidden) => patch({ hidden })} />}
        {config.sort && config.view === 'table' && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch({ sort: undefined })}>
            ביטול מיון
          </button>
        )}
        {isFiltered && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => patch({ search: undefined, mine: undefined, statusFilter: undefined })}>
            ניקוי סינון
          </button>
        )}
        <span className="muted" role="status" aria-live="polite" style={{ marginInlineStart: 'auto' }}>
          {isFiltered ? `${shownCount} מתוך ${topCount} פריטים` : `${topCount} פריטים`}
        </span>
      </div>

      {config.view === 'table' && (
        <TableView
          board={b}
          items={filteredItems}
          users={users}
          onOpenItem={openItem}
          filtered={isFiltered}
          config={config}
          onSort={(sort) => patch({ sort })}
          onResize={(columnId, width) =>
            setConfig((c) => {
              const widths = { ...(c.widths ?? {}) };
              if (width === null) delete widths[columnId];
              else widths[columnId] = width;
              const next = Object.keys(widths).length ? widths : undefined;
              writeWidths(boardId, next);
              return { ...c, widths: next };
            })
          }
          selected={selected}
          onSelect={onSelect}
        />
      )}
      {config.view === 'kanban' && (
        <KanbanView board={b} items={filteredItems.filter((i) => !i.parentId)} users={users} onOpenItem={openItem} columnId={config.kanbanColumnId} onColumnChange={(id) => patch({ kanbanColumnId: id })} />
      )}
      {config.view === 'calendar' && (
        <CalendarView board={b} items={filteredItems} onOpenItem={openItem} columnId={config.calendarColumnId} onColumnChange={(id) => patch({ calendarColumnId: id })} />
      )}

      {config.view === 'gantt' && (
        <GanttView board={b} items={filteredItems.filter((i) => !i.parentId)} onOpenItem={openItem} scale={config.ganttScale ?? 'week'} onScaleChange={(ganttScale) => patch({ ganttScale })} />
      )}
      {config.view === 'risk' && (
        <RiskMatrixView board={b} items={filteredItems.filter((i) => !i.parentId)} onOpenItem={openItem} columnId={config.riskColumnId} onColumnChange={(id) => patch({ riskColumnId: id })} />
      )}

      {isFiltered && shownCount === 0 && <p className="muted">לא נמצאו פריטים התואמים לסינון.</p>}

      {canEdit && config.view === 'table' && (
        <form onSubmit={addGroup} className="toolbar" style={{ marginTop: 'var(--space-2)' }}>
          <label htmlFor="new-group" className="sr-only">
            שם קבוצה חדשה
          </label>
          <input id="new-group" className="input" placeholder="שם קבוצה חדשה" maxLength={80} value={newGroup} onChange={(e) => setNewGroup(e.target.value)} />
          <button type="submit" className="btn" disabled={groups.create.isPending || !newGroup.trim()}>
            <Icon name="plus" /> הוספת קבוצה
          </button>
        </form>
      )}

      {canEdit && config.view === 'table' && <BulkBar board={b} selected={selected} onClear={() => setSelected(new Set())} />}

      <ItemDrawer key={openItemId ?? 'none'} board={b} itemId={openItemId} users={users} onClose={closeItem} onOpenItem={openItem} />
      {canEdit && <TrashDialog board={b} open={dialog === 'trash'} onClose={() => setDialog(null)} />}
      {canEdit && <ImportDialog board={b} members={members} open={dialog === 'import'} onClose={() => setDialog(null)} />}
    </>
  );
}
