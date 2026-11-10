import { LIMITS, type BoardDetail, type Column, type ColumnSettings } from '@suboard/shared';
import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { useBoard, useBoardCompliance, useBoards, useConfigureCompliance } from '../../api/hooks';
import { useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';

type ChecklistSettings = NonNullable<ColumnSettings['checklist']>;
const slug = () => `i${Math.random().toString(36).slice(2, 8)}`;

/** Checklist items + the corrective-action board that failed items open on. */
export function ChecklistSettingsEditor({ board, column, saving, onSave }: { board: BoardDetail; column: Column; saving: boolean; onSave: (s: ChecklistSettings) => void }) {
  const cur = column.settings.checklist ?? { items: [] };
  const [items, setItems] = useState(cur.items.length ? cur.items : [{ id: slug(), label: '' }]);
  const [capaBoardId, setCapaBoardId] = useState(cur.capaBoardId ?? '');
  const [capaGroupId, setCapaGroupId] = useState(cur.capaGroupId ?? '');
  const boards = useBoards();
  const target = useBoard(capaBoardId);
  const ids = { b: useId(), g: useId() };
  const editable = (boards.data ?? []).filter((b) => b.id !== board.id && b.myRole !== 'viewer');

  return (
    <div className="options-editor">
      <ol className="list-plain checklist-settings">
        {items.map((it, i) => (
          <li key={it.id} className="option-row">
            <span className="num" aria-hidden="true">
              {i + 1}.
            </span>
            <input
              className="input"
              aria-label={`סעיף ${i + 1}`}
              maxLength={200}
              value={it.label}
              onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))}
            />
            <button type="button" className="icon-btn" aria-label={`הזזת סעיף ${i + 1} למעלה`} disabled={i === 0} onClick={() => setItems(items.map((x, j) => (j === i - 1 ? items[i]! : j === i ? items[i - 1]! : x)))}>
              ▲
            </button>
            <button type="button" className="icon-btn" aria-label={`מחיקת סעיף ${i + 1}`} disabled={items.length === 1} onClick={() => setItems(items.filter((_, j) => j !== i))}>
              <Icon name="trash" size={16} />
            </button>
          </li>
        ))}
      </ol>
      {items.length < LIMITS.checklistItems && (
        <button type="button" className="btn btn-sm" onClick={() => setItems([...items, { id: slug(), label: '' }])}>
          <Icon name="plus" /> סעיף
        </button>
      )}
      <div className="rule-row" style={{ marginTop: 'var(--space-3)' }}>
        <div className="field">
          <label htmlFor={ids.b}>סעיף "לא תקין" פותח פעולה מתקנת בלוח</label>
          <select id={ids.b} className="select" value={capaBoardId} onChange={(e) => (setCapaBoardId(e.target.value), setCapaGroupId(''))}>
            <option value="">ללא — רק סימון</option>
            {editable.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <span className="hint">רק לוחות שבהם יש לך הרשאת עריכה. הפעולה נפתחת גם כשהסוקר אינו חבר בלוח היעד.</span>
        </div>
        {capaBoardId && (
          <div className="field">
            <label htmlFor={ids.g}>בקבוצה</label>
            <select id={ids.g} className="select" value={capaGroupId || target.data?.groups[0]?.id || ''} onChange={(e) => setCapaGroupId(e.target.value)}>
              {(target.data?.groups ?? []).map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>
      <button
        type="button"
        className="btn btn-primary btn-sm"
        disabled={saving || items.some((x) => !x.label.trim())}
        onClick={() =>
          onSave({
            items: items.map((x) => ({ id: x.id, label: x.label.trim() })),
            capaBoardId: capaBoardId || null,
            capaGroupId: capaBoardId ? capaGroupId || target.data?.groups[0]?.id || null : null,
          })
        }
      >
        שמירת הצ'קליסט
      </button>
    </div>
  );
}

/** Board settings card: which date column drives periodic compliance, and how to group it. */
export function ComplianceSection({ board }: { board: BoardDetail }) {
  const q = useBoardCompliance(board.id);
  const save = useConfigureCompliance(board.id);
  const { toast } = useFeedback();
  const dates = board.columns.filter((c) => c.type === 'date');
  const groupables = board.columns.filter((c) => ['status', 'tags', 'text', 'person'].includes(c.type));
  const cur = q.data?.settings;
  const [dateColumnId, setDate] = useState<string | null>(null);
  const [groupBy, setGroupBy] = useState<string | null>(null);
  const [windowDays, setWindow] = useState<number | null>(null);
  const d = dateColumnId ?? cur?.dateColumnId ?? '';
  const g = groupBy ?? cur?.groupByColumnId ?? '';
  const w = windowDays ?? cur?.windowDays ?? 30;
  const ids = { d: useId(), g: useId(), w: useId() };
  const onErr = (e: unknown) => toast(errorMessage(e), 'error');

  return (
    <section className="card" aria-labelledby="comp-h">
      <h2 id="comp-h">מעקב תאימות תקופתית</h2>
      <p className="muted">
        לוח עם תאריך "בדיקה הבאה" מקבל אחוז עמידה, פילוח לפי מבנה/מיקום ורשימת חריגות. מופיע בעמוד <Link to="/compliance">תאימות</Link>. כדי לקדם את התאריך אוטומטית אחרי בדיקה — השתמשו במתכון האוטומציה
        "בדיקה תקופתית".
      </p>
      {dates.length === 0 ? (
        <p className="muted">נדרשת עמודת תאריך בלוח.</p>
      ) : (
        <>
          <div className="rule-row">
            <div className="field">
              <label htmlFor={ids.d}>עמודת "בדיקה הבאה"</label>
              <select id={ids.d} className="select" value={d} onChange={(e) => setDate(e.target.value)}>
                {!d && <option value="">— בחירה —</option>}
                {dates.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={ids.g}>פילוח לפי</label>
              <select id={ids.g} className="select" value={g} onChange={(e) => setGroupBy(e.target.value)}>
                <option value="">ללא</option>
                {groupables.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor={ids.w}>"קרוב" = בתוך ימים</label>
              <input id={ids.w} type="number" className="input" min={1} max={180} value={w} onChange={(e) => setWindow(Math.max(1, Math.min(180, Math.trunc(Number(e.target.value) || 30))))} />
            </div>
          </div>
          <div className="toolbar">
            <button
              type="button"
              className="btn btn-primary"
              disabled={!d || save.isPending}
              onClick={() => save.mutate({ dateColumnId: d, groupByColumnId: g || null, windowDays: w }, { onSuccess: () => (toast('מעקב התאימות נשמר'), void q.refetch()), onError: onErr })}
            >
              {cur ? 'עדכון' : 'הפעלת מעקב תאימות'}
            </button>
            {cur && (
              <button type="button" className="btn btn-ghost" onClick={() => save.mutate(null, { onSuccess: () => (toast('מעקב התאימות בוטל'), void q.refetch()), onError: onErr })}>
                ביטול מעקב
              </button>
            )}
            {cur && q.data && (
              <span className="badge">{q.data.summary.percent === null ? 'אין פריטים' : `${q.data.summary.percent}% עמידה`}</span>
            )}
          </div>
        </>
      )}
    </section>
  );
}
