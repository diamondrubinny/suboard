import {
  checklistStats,
  isRiskValue,
  LIKELIHOOD_LABELS,
  RISK_LEVEL_COLORS,
  RISK_LEVEL_LABELS,
  riskLevel,
  riskScore,
  SEVERITY_LABELS,
  type ChecklistResult,
  type ChecklistValue,
  type Column,
  type RiskValue,
} from '@suboard/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { colorStyle } from '../StatusPill';

/** Coloured "12 · גבוה" pill; the text always carries the level (never colour alone). */
export function RiskPill({ value }: { value: RiskValue | null }) {
  if (!value) return <span className="muted">—</span>;
  const score = riskScore(value);
  const level = riskLevel(score);
  return (
    <span className="pill risk-pill" style={colorStyle(RISK_LEVEL_COLORS[level])}>
      {score} · {RISK_LEVEL_LABELS[level]}
    </span>
  );
}

/** Likelihood × severity picker in a disclosure popover (two labelled selects). */
export function RiskEditor({ value, label, readOnly, onChange }: { value: unknown; label: string; readOnly: boolean; onChange: (v: RiskValue | null) => void }) {
  const server = isRiskValue(value) ? value : null;
  const [local, setLocal] = useState<RiskValue | null>(server);
  const key = server ? `${server.l}x${server.s}` : '';
  useEffect(() => setLocal(server), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popId = useId();
  const lId = useId();
  const sId = useId();

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLSelectElement>('.popover select')?.focus();
    const onDown = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  if (readOnly) return <RiskPill value={local} />;
  const set = (patch: Partial<RiskValue>) => {
    const next = { l: local?.l ?? 3, s: local?.s ?? 3, ...patch };
    setLocal(next);
    onChange(next);
  };
  return (
    <div
      className="person-cell"
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
          triggerRef.current?.focus();
        }
      }}
    >
      <button ref={triggerRef} type="button" className="person-trigger" aria-expanded={open} aria-controls={popId} onClick={() => setOpen((o) => !o)}>
        <span className="sr-only">{label}: </span>
        {local ? <RiskPill value={local} /> : <span className="muted">— <span className="sr-only">לא הוערך</span></span>}
      </button>
      {open && (
        <div className="popover risk-popover" id={popId}>
          <fieldset>
            <legend>{label}</legend>
            <label htmlFor={lId}>סבירות</label>
            <select id={lId} className="select" value={local?.l ?? ''} onChange={(e) => set({ l: Number(e.target.value) })}>
              {!local && <option value="">— בחירה —</option>}
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} — {LIKELIHOOD_LABELS[n]}
                </option>
              ))}
            </select>
            <label htmlFor={sId}>חומרה</label>
            <select id={sId} className="select" value={local?.s ?? ''} onChange={(e) => set({ s: Number(e.target.value) })}>
              {!local && <option value="">— בחירה —</option>}
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} — {SEVERITY_LABELS[n]}
                </option>
              ))}
            </select>
            <p className="risk-result" aria-live="polite">
              ציון: <RiskPill value={local} />
            </p>
            {local && (
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => {
                  setLocal(null);
                  onChange(null);
                }}
              >
                ניקוי הערכה
              </button>
            )}
          </fieldset>
        </div>
      )}
    </div>
  );
}

const RESULTS: [ChecklistResult, string][] = [
  ['pass', 'תקין'],
  ['fail', 'לא תקין'],
  ['na', 'לא רלוונטי'],
];

/** "5/8 · 1 לא תקין" — compact summary for the table. */
export function ChecklistSummary({ column, value }: { column: Column; value: unknown }) {
  const st = checklistStats(column, value);
  const done = st.total - st.open;
  return (
    <span className="checklist-summary">
      <span className="num">
        {done}/{st.total}
      </span>
      {st.fail > 0 && <span className="badge danger">{st.fail} לא תקין</span>}
      {st.open === 0 && st.fail === 0 && st.total > 0 && <span className="badge success">הושלם</span>}
    </span>
  );
}

/**
 * Full checklist for the item drawer: one radio group per entry. A failed entry shows its linked
 * corrective action (opened automatically by the server when the column is wired to a board).
 */
export function ChecklistEditor({ column, value, label, readOnly, onChange }: { column: Column; value: unknown; label: string; readOnly: boolean; onChange: (v: ChecklistValue | null) => void }) {
  const server = (value && typeof value === 'object' && !Array.isArray(value) ? value : {}) as ChecklistValue;
  const [local, setLocal] = useState<ChecklistValue>(server);
  const key = JSON.stringify(server);
  useEffect(() => setLocal(server), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const items = column.settings.checklist?.items ?? [];
  const wired = Boolean(column.settings.checklist?.capaBoardId);
  const base = useId();

  const set = (id: string, r: ChecklistResult | null) => {
    const next = { ...local };
    if (r) next[id] = { r, ...(local[id]?.capa ? { capa: local[id]!.capa } : {}) };
    else delete next[id];
    setLocal(next);
    onChange(Object.keys(next).length ? (Object.fromEntries(Object.entries(next).map(([k, e]) => [k, { r: e.r }])) as ChecklistValue) : null);
  };

  return (
    <div className="checklist" role="group" aria-label={label}>
      <ChecklistSummary column={column} value={local} />
      {wired && !readOnly && <p className="hint">סעיף "לא תקין" פותח פעולה מתקנת אוטומטית.</p>}
      <ol className="checklist-items">
        {items.map((it, idx) => {
          const cur = local[it.id];
          return (
            <li key={it.id} className={cur?.r === 'fail' ? 'checklist-item fail' : 'checklist-item'}>
              <fieldset disabled={readOnly}>
                <legend>
                  <span className="num">{idx + 1}.</span> {it.label}
                </legend>
                <div className="checklist-choices">
                  {RESULTS.map(([r, text]) => (
                    <label key={r} className={`choice choice-${r}`}>
                      <input type="radio" name={`${base}-${it.id}`} checked={cur?.r === r} onChange={() => set(it.id, r)} />
                      <span>{text}</span>
                    </label>
                  ))}
                  {cur && !readOnly && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => set(it.id, null)}>
                      ניקוי<span className="sr-only"> של הסעיף {it.label}</span>
                    </button>
                  )}
                </div>
                {cur?.capa && (
                  <Link className="checklist-capa" to={`/q/${cur.capa}`}>
                    פעולה מתקנת נפתחה — לצפייה
                  </Link>
                )}
              </fieldset>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
