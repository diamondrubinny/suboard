import { formatDateHe, RISK_LEVEL_COLORS, RISK_LEVEL_LABELS, type BoardSummary, type Widget, type WidgetData, type WidgetInput } from '@suboard/shared';
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { TrendChart } from '../../components/charts/TrendChart';
import { Dialog } from '../../components/Dialog';
import { colorStyle } from '../../components/StatusPill';

export const WIDGET_LABELS: Record<Widget['type'], string> = {
  count: 'מספר',
  status: 'התפלגות סטטוס (לוח אחד)',
  trend: 'מגמה: נפתחו מול נסגרו',
  overdue: 'רשימת איחורים',
  workload: 'עומס לפי אחראי',
  compliance: 'תאימות',
  risk: 'רמות סיכון (פריטים פתוחים)',
};
export const METRIC_LABELS = { open: 'פריטים פתוחים', overdue: 'באיחור', due_week: 'יעד ב-7 ימים', created_month: 'נפתחו החודש', closed_month: 'נסגרו החודש' } as const;

export function defaultTitle(w: WidgetInput): string {
  if (w.title) return w.title;
  if (w.type === 'count') return METRIC_LABELS[w.metric];
  return WIDGET_LABELS[w.type];
}

const newId = () => Math.random().toString(36).slice(2, 10).padEnd(6, '0');

/** The default management dashboard (counts, trend, overdue, workload, compliance, risk). */
export function presetWidgets(): WidgetInput[] {
  return [
    { id: newId(), type: 'count', metric: 'open', boardIds: [], size: 's' },
    { id: newId(), type: 'count', metric: 'overdue', boardIds: [], size: 's' },
    { id: newId(), type: 'count', metric: 'closed_month', boardIds: [], size: 's' },
    { id: newId(), type: 'trend', boardIds: [], period: 'month', count: 6, size: 'l' },
    { id: newId(), type: 'overdue', boardIds: [], limit: 10, size: 'm' },
    { id: newId(), type: 'workload', boardIds: [], size: 'm' },
    { id: newId(), type: 'compliance', boardIds: [], size: 'm' },
    { id: newId(), type: 'risk', boardIds: [], size: 'm' },
  ];
}

/** Renders one widget's data (already filtered to the viewer's boards by the server). */
export function WidgetBody({ widget, data }: { widget: Widget; data: WidgetData | undefined }) {
  if (!data) return <p className="muted">טוען…</p>;
  switch (data.type) {
    case 'empty':
      return <p className="muted">{data.reason}</p>;
    case 'count':
      return (
        <p className="widget-number">
          <span className="value">{data.value}</span>
          <span className="muted">{data.boards === 1 ? 'מלוח אחד' : `מ-${data.boards} לוחות`}</span>
        </p>
      );
    case 'status': {
      const max = Math.max(1, ...data.rows.map((r) => r.count));
      return (
        <>
          <p className="muted widget-sub">{data.boardName}</p>
          <ul className="list-plain status-bars">
            {data.rows.map((r) => (
              <li key={r.label}>
                <span className="status-bar-label">{r.label}</span>
                <span className="status-bar-track" aria-hidden="true">
                  <span className="status-bar-fill" style={{ ...colorStyle(r.color), inlineSize: `${(r.count / max) * 100}%` }} />
                </span>
                <span className="status-bar-count">{r.count}</span>
              </li>
            ))}
          </ul>
        </>
      );
    }
    case 'trend':
      return <TrendChart points={data.points} title={defaultTitle(widget)} />;
    case 'overdue':
      return data.items.length ? (
        <ul className="list-plain report-items">
          {data.items.map((i) => (
            <li key={i.id}>
              <Link to={`/boards/${i.boardId}?item=${i.id}`}>{i.name}</Link> <span className="badge danger">{i.daysLate} ימים</span>{' '}
              <span className="muted">
                {i.boardName} · יעד {formatDateHe(i.due)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">אין פריטים באיחור.</p>
      );
    case 'workload':
      return data.rows.length ? <WorkloadTable rows={data.rows} compact /> : <p className="muted">אין פריטים משויכים.</p>;
    case 'compliance':
      return data.rows.length ? (
        <ul className="list-plain widget-rows">
          {data.rows.map((r) => (
            <li key={r.boardId}>
              <Link to={`/boards/${r.boardId}`}>{r.boardName}</Link>
              <Meter percent={r.percent} />
              {r.overdue > 0 && <span className="badge danger">{r.overdue} באיחור</span>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">אין לוחות עם מעקב תאימות.</p>
      );
    case 'risk': {
      const max = Math.max(1, ...data.levels.map((l) => l.count));
      return (
        <>
          <ul className="list-plain status-bars">
            {data.levels.map((l) => (
              <li key={l.level}>
                <span className="status-bar-label">{RISK_LEVEL_LABELS[l.level]}</span>
                <span className="status-bar-track" aria-hidden="true">
                  <span className="status-bar-fill" style={{ ...colorStyle(RISK_LEVEL_COLORS[l.level]), inlineSize: `${(l.count / max) * 100}%` }} />
                </span>
                <span className="status-bar-count">{l.count}</span>
              </li>
            ))}
          </ul>
          {data.unassessed > 0 && <p className="muted widget-sub">{data.unassessed} פריטים פתוחים ללא הערכת סיכון</p>}
        </>
      );
    }
  }
}

export function Meter({ percent }: { percent: number | null }) {
  if (percent === null) return <span className="muted">—</span>;
  const tone = percent >= 90 ? 'good' : percent >= 70 ? 'warn' : 'bad';
  return (
    <span className={`meter meter-${tone}`}>
      <span className="meter-track" aria-hidden="true">
        <span className="meter-fill" style={{ inlineSize: `${percent}%` }} />
      </span>
      <strong className="num">{percent}%</strong>
    </span>
  );
}

export function WorkloadTable({ rows, compact }: { rows: import('@suboard/shared').WorkloadRow[]; compact?: boolean }) {
  return (
    <div className="table-scroll" tabIndex={0} role="region" aria-label="טבלת עומס">
      <table className="data-table">
        <caption className="sr-only">עומס לפי אחראי</caption>
        <thead>
          <tr>
            <th scope="col">אחראי</th>
            <th scope="col">פתוחים</th>
            <th scope="col">באיחור</th>
            <th scope="col">יעד ב-7 ימים</th>
            {!compact && <th scope="col">ללא יעד</th>}
            {!compact && <th scope="col">לפי לוח</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.userId}>
              <th scope="row">{r.name}</th>
              <td className="num">{r.open}</td>
              <td className="num">{r.overdue ? <span className="badge danger">{r.overdue}</span> : 0}</td>
              <td className="num">{r.dueWeek}</td>
              {!compact && <td className="num">{r.noDue}</td>}
              {!compact && (
                <td>
                  {r.boards.map((b) => (
                    <span key={b.boardId} className="workload-board">
                      <Link to={`/boards/${b.boardId}`}>{b.boardName}</Link> {b.open}
                      {b.overdue ? ` (${b.overdue} באיחור)` : ''}
                    </span>
                  ))}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------- editor
export function WidgetEditor({ widget, boards, onSave, onClose }: { widget: WidgetInput | null; boards: BoardSummary[]; onSave: (w: WidgetInput) => void; onClose: () => void }) {
  const [w, setW] = useState<WidgetInput>(widget ?? { id: newId(), type: 'count', metric: 'open', boardIds: [], size: 's' });
  const ids = { type: useId(), title: useId(), size: useId(), metric: useId(), board: useId(), period: useId(), count: useId(), limit: useId() };
  const switchType = (type: Widget['type']) => {
    const base = { id: w.id, title: w.title, size: w.size };
    const firstBoard = boards[0]?.id ?? '';
    const map: Record<Widget['type'], WidgetInput> = {
      count: { ...base, type: 'count', metric: 'open', boardIds: [] },
      status: { ...base, type: 'status', boardId: firstBoard },
      trend: { ...base, type: 'trend', boardIds: [], period: 'month', count: 6, size: 'l' },
      overdue: { ...base, type: 'overdue', boardIds: [], limit: 10 },
      workload: { ...base, type: 'workload', boardIds: [] },
      compliance: { ...base, type: 'compliance', boardIds: [] },
      risk: { ...base, type: 'risk', boardIds: [] },
    };
    setW(map[type]);
  };
  const boardIds = 'boardIds' in w ? (w.boardIds ?? []) : [];
  const setBoards = (next: string[]) => setW({ ...w, boardIds: next } as WidgetInput);

  return (
    <Dialog
      open
      onClose={onClose}
      title={widget ? 'עריכת ווידג\'ט' : 'ווידג\'ט חדש'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className="btn btn-primary" disabled={w.type === 'status' && !w.boardId} onClick={() => onSave(w)}>
            שמירה
          </button>
        </>
      }
    >
      <div className="rule-editor">
        <div className="rule-row">
          <div className="field">
            <label htmlFor={ids.type}>סוג</label>
            <select id={ids.type} className="select" value={w.type} onChange={(e) => switchType(e.target.value as Widget['type'])}>
              {(Object.keys(WIDGET_LABELS) as Widget['type'][]).map((t) => (
                <option key={t} value={t}>
                  {WIDGET_LABELS[t]}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={ids.size}>גודל</label>
            <select id={ids.size} className="select" value={w.size ?? 'm'} onChange={(e) => setW({ ...w, size: e.target.value as 's' | 'm' | 'l' })}>
              <option value="s">קטן</option>
              <option value="m">בינוני</option>
              <option value="l">רחב</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor={ids.title}>כותרת (לא חובה)</label>
          <input id={ids.title} className="input" maxLength={60} value={w.title ?? ''} placeholder={defaultTitle({ ...w, title: undefined })} onChange={(e) => setW({ ...w, title: e.target.value || undefined })} />
        </div>
        {w.type === 'count' && (
          <div className="field">
            <label htmlFor={ids.metric}>מה לספור</label>
            <select id={ids.metric} className="select" value={w.metric} onChange={(e) => setW({ ...w, metric: e.target.value as typeof w.metric })}>
              {Object.entries(METRIC_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        )}
        {w.type === 'status' && (
          <div className="field">
            <label htmlFor={ids.board}>לוח</label>
            <select id={ids.board} className="select" value={w.boardId} onChange={(e) => setW({ ...w, boardId: e.target.value })}>
              {boards.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </div>
        )}
        {w.type === 'trend' && (
          <div className="rule-row">
            <div className="field">
              <label htmlFor={ids.period}>לפי</label>
              <select id={ids.period} className="select" value={w.period ?? 'month'} onChange={(e) => setW({ ...w, period: e.target.value as 'week' | 'month' })}>
                <option value="month">חודש</option>
                <option value="week">שבוע</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor={ids.count}>מספר תקופות</label>
              <input id={ids.count} type="number" className="input" min={3} max={24} value={w.count ?? 6} onChange={(e) => setW({ ...w, count: Math.max(3, Math.min(24, Math.trunc(Number(e.target.value) || 6))) })} />
            </div>
          </div>
        )}
        {w.type === 'overdue' && (
          <div className="field">
            <label htmlFor={ids.limit}>מספר פריטים</label>
            <input id={ids.limit} type="number" className="input" min={3} max={30} value={w.limit ?? 10} onChange={(e) => setW({ ...w, limit: Math.max(3, Math.min(30, Math.trunc(Number(e.target.value) || 10))) })} />
          </div>
        )}
        {w.type !== 'status' && (
          <fieldset className="check-list">
            <legend className="label">לוחות (ללא בחירה = כל הלוחות שהצופה רואה)</legend>
            {boards.map((b) => (
              <label key={b.id} className="check">
                <input type="checkbox" checked={boardIds.includes(b.id)} onChange={(e) => setBoards(e.target.checked ? [...boardIds, b.id] : boardIds.filter((x) => x !== b.id))} /> {b.name}
              </label>
            ))}
          </fieldset>
        )}
        <p className="hint">בדשבורד משותף, כל צופה רואה רק נתונים מלוחות שיש לו גישה אליהם.</p>
      </div>
    </Dialog>
  );
}
