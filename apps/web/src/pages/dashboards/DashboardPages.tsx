import type { WidgetInput } from '@suboard/shared';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ApiError, errorMessage } from '../../api/client';
import { useBoards, useCustomDashboard, useDashboardData, useDashboardMutations, useDashboards } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { usePageTitle } from '../../components/Layout';
import { defaultTitle, presetWidgets, WidgetBody, WidgetEditor } from './Widgets';

export function DashboardsPage() {
  usePageTitle('דשבורדים');
  const q = useDashboards();
  const { create } = useDashboardMutations();
  const { user } = useAuth();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const canShare = user?.role === 'admin' || user?.role === 'manager';

  const submit = (e: FormEvent, preset: boolean) => {
    e.preventDefault();
    if (!name.trim()) return toast('יש לתת שם לדשבורד', 'error');
    create.mutate(
      { name: name.trim(), shared, widgets: preset ? presetWidgets() : [] },
      { onSuccess: (d) => navigate(`/dashboards/${d.id}`), onError: (err) => toast(errorMessage(err), 'error') },
    );
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>דשבורדים</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            ווידג'טים חוצי-לוחות: מספרים, מגמות, איחורים, עומס, תאימות וסיכונים.
          </p>
        </div>
      </div>
      <form className="card" onSubmit={(e) => submit(e, true)} aria-labelledby="new-dash">
        <h2 id="new-dash">דשבורד חדש</h2>
        <div className="toolbar">
          <label htmlFor="dash-name" className="sr-only">
            שם הדשבורד
          </label>
          <input id="dash-name" className="input" placeholder="שם הדשבורד" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          {canShare && (
            <label className="check">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> משותף לכל המשתמשים
            </label>
          )}
          <button type="submit" className="btn btn-primary" disabled={create.isPending}>
            יצירה עם ווידג'טים מומלצים
          </button>
          <button type="button" className="btn" disabled={create.isPending} onClick={(e) => submit(e as unknown as FormEvent, false)}>
            יצירה ריקה
          </button>
        </div>
      </form>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data && q.data.length > 0 && (
        <ul className="list-plain grid grid-cards" style={{ marginTop: 'var(--space-4)' }}>
          {q.data.map((d) => (
            <li key={d.id} className="card dash-card">
              <h3>
                <Link to={`/dashboards/${d.id}`}>{d.name}</Link>
              </h3>
              <p className="muted">
                {d.widgets.length} ווידג'טים · {d.shared ? `משותף${d.isOwner ? '' : ` · ${d.ownerName ?? ''}`}` : 'אישי'}
              </p>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

export function CustomDashboardPage() {
  const { dashboardId = '' } = useParams();
  const q = useCustomDashboard(dashboardId);
  const data = useDashboardData(dashboardId, q.isSuccess);
  const boards = useBoards();
  const { update, remove } = useDashboardMutations();
  const { toast, confirm } = useFeedback();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<WidgetInput | 'new' | null>(null);
  usePageTitle(q.data?.name ?? 'דשבורד');

  if (q.isPending) return <LoadingState />;
  if (q.isError) {
    if (q.error instanceof ApiError && q.error.status === 404)
      return (
        <div className="state" role="alert">
          <h1>הדשבורד לא נמצא</h1>
          <Link to="/dashboards" className="btn">
            לדשבורדים
          </Link>
        </div>
      );
    return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;
  }
  const d = q.data;
  const save = (widgets: WidgetInput[], msg?: string) =>
    update.mutate({ id: d.id, patch: { widgets } }, { onSuccess: () => msg && toast(msg), onError: (e) => toast(errorMessage(e), 'error') });
  const move = (i: number, dir: -1 | 1) => {
    const ws = [...d.widgets];
    const j = i + dir;
    if (j < 0 || j >= ws.length) return;
    [ws[i], ws[j]] = [ws[j]!, ws[i]!];
    save(ws);
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>{d.name}</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            {d.shared ? 'משותף — כל צופה רואה רק לוחות שיש לו גישה אליהם' : 'דשבורד אישי'}
            {data.dataUpdatedAt ? ` · עודכן ${new Date(data.dataUpdatedAt).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' })}` : ''}
          </p>
        </div>
        <div className="actions no-print">
          <button type="button" className="btn" onClick={() => window.print()}>
            <Icon name="printer" /> PDF / הדפסה
          </button>
          {d.isOwner && (
            <button type="button" className="btn" aria-pressed={editing} onClick={() => setEditing((x) => !x)}>
              <Icon name="gear" /> {editing ? 'סיום עריכה' : 'עריכה'}
            </button>
          )}
          {d.isOwner && editing && (
            <>
              <button type="button" className="btn btn-primary" onClick={() => setDialog('new')}>
                <Icon name="plus" /> ווידג'ט
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                onClick={async () => {
                  if (await confirm({ title: 'מחיקת דשבורד', message: `למחוק את "${d.name}"?`, confirmLabel: 'מחיקה', danger: true })) {
                    remove.mutate(d.id, { onSuccess: () => (toast('הדשבורד נמחק'), navigate('/dashboards')) });
                  }
                }}
              >
                מחיקה
              </button>
            </>
          )}
        </div>
      </div>
      {d.widgets.length === 0 && (
        <div className="empty-state">
          <Icon name="chart" />
          <p>{d.isOwner ? 'אין ווידג\'טים. לחצו "עריכה" ואז "ווידג\'ט".' : 'אין ווידג\'טים בדשבורד זה.'}</p>
        </div>
      )}
      <div className="widget-grid">
        {d.widgets.map((w, i) => (
          <section key={w.id} className={`card widget widget-${w.size}`} aria-labelledby={`wh-${w.id}`}>
            <div className="widget-head">
              <h2 id={`wh-${w.id}`}>{defaultTitle(w)}</h2>
              {editing && (
                <div className="widget-tools no-print">
                  <button type="button" className="icon-btn" aria-label={`הזזת "${defaultTitle(w)}" אחורה`} disabled={i === 0} onClick={() => move(i, -1)}>
                    ▲
                  </button>
                  <button type="button" className="icon-btn" aria-label={`הזזת "${defaultTitle(w)}" קדימה`} disabled={i === d.widgets.length - 1} onClick={() => move(i, 1)}>
                    ▼
                  </button>
                  <button type="button" className="btn btn-sm" onClick={() => setDialog(w)}>
                    עריכה<span className="sr-only"> של {defaultTitle(w)}</span>
                  </button>
                  <button type="button" className="icon-btn" aria-label={`הסרת "${defaultTitle(w)}"`} onClick={() => save(d.widgets.filter((x) => x.id !== w.id), 'הווידג\'ט הוסר')}>
                    <Icon name="trash" size={16} />
                  </button>
                </div>
              )}
            </div>
            <WidgetBody widget={w} data={data.data?.[w.id]} />
          </section>
        ))}
      </div>
      {dialog && (
        <WidgetEditor
          widget={dialog === 'new' ? null : dialog}
          boards={boards.data ?? []}
          onClose={() => setDialog(null)}
          onSave={(w) => {
            const exists = d.widgets.some((x) => x.id === w.id);
            save(exists ? d.widgets.map((x) => (x.id === w.id ? (w as never) : x)) : [...d.widgets, w], 'הדשבורד עודכן');
            setDialog(null);
          }}
        />
      )}
    </>
  );
}
