import {
  isRiskValue,
  LIKELIHOOD_LABELS,
  RISK_LEVEL_COLORS,
  RISK_LEVEL_LABELS,
  riskLevel,
  SEVERITY_LABELS,
  type BoardDetail,
  type Item,
} from '@suboard/shared';
import { useState } from 'react';
import { colorStyle } from '../../components/StatusPill';
import { RiskPill } from '../../components/cells/FieldCells';

/**
 * 5×5 heat map (likelihood rows, severity columns) with the number of items per cell. A cell is a
 * toggle button that filters the list below; every cell states its score and level in text.
 */
export function RiskMatrixView({
  board,
  items,
  columnId,
  onColumnChange,
  onOpenItem,
}: {
  board: BoardDetail;
  items: Item[];
  columnId?: string;
  onColumnChange: (id: string) => void;
  onOpenItem: (id: string) => void;
}) {
  const riskCols = board.columns.filter((c) => c.type === 'risk');
  const col = riskCols.find((c) => c.id === columnId) ?? riskCols[0];
  const [cell, setCell] = useState<{ l: number; s: number } | null>(null);
  if (!col) return <p className="muted">אין בלוח עמודת מטריצת סיכון. בעלי הלוח יכולים להוסיף אחת בהגדרות.</p>;

  const scored = items.filter((i) => isRiskValue(i.values[col.id]));
  const at = (l: number, s: number) => scored.filter((i) => {
    const v = i.values[col.id] as { l: number; s: number };
    return v.l === l && v.s === s;
  });
  const shown = (cell ? at(cell.l, cell.s) : scored).slice().sort((a, b) => {
    const va = a.values[col.id] as { l: number; s: number };
    const vb = b.values[col.id] as { l: number; s: number };
    return vb.l * vb.s - va.l * va.s;
  });

  return (
    <div className="risk-view">
      {riskCols.length > 1 && (
        <div className="field" style={{ maxInlineSize: '20rem' }}>
          <label htmlFor="risk-col">עמודת סיכון</label>
          <select id="risk-col" className="select" value={col.id} onChange={(e) => (onColumnChange(e.target.value), setCell(null))}>
            {riskCols.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
      )}
      <div className="risk-layout">
        {/* Focusable so keyboard users can scroll it on narrow screens. */}
        <div className="table-scroll" tabIndex={0} role="region" aria-label="מפת סיכונים">
          <table className="risk-matrix">
            <caption>
              מפת סיכונים — {col.title} ({scored.length} פריטים מוערכים מתוך {items.length})
            </caption>
            <thead>
              <tr>
                <td className="risk-corner">
                  <span className="sr-only">סבירות / חומרה</span>
                </td>
                {[1, 2, 3, 4, 5].map((s) => (
                  <th key={s} scope="col">
                    <span className="num">{s}</span> {SEVERITY_LABELS[s]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {[5, 4, 3, 2, 1].map((l) => (
                <tr key={l}>
                  <th scope="row">
                    <span className="num">{l}</span> {LIKELIHOOD_LABELS[l]}
                  </th>
                  {[1, 2, 3, 4, 5].map((s) => {
                    const n = at(l, s).length;
                    const level = riskLevel(l * s);
                    const active = cell?.l === l && cell?.s === s;
                    return (
                      <td key={s} className="risk-cell-td">
                        <button
                          type="button"
                          className={`risk-cell${n ? '' : ' empty'}`}
                          style={colorStyle(RISK_LEVEL_COLORS[level])}
                          aria-pressed={active}
                          onClick={() => setCell(active ? null : { l, s })}
                        >
                          {/* The accessible name starts with the visible count (WCAG 2.5.3 label in name). */}
                          <span className="risk-count">{n || ''}</span>
                          <span className="sr-only">
                            {n ? '' : '0 '}פריטים — סבירות {l}, חומרה {s}: ציון {l * s}, {RISK_LEVEL_LABELS[level]}
                          </span>
                          <span className="risk-score" aria-hidden="true">
                            {l * s}
                          </span>
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted risk-axis">שורות: סבירות · עמודות: חומרה. ציון = סבירות × חומרה.</p>
        </div>
        <section className="card risk-list" aria-labelledby="risk-list-h" aria-live="polite">
          <h2 id="risk-list-h">{cell ? `סבירות ${cell.l} × חומרה ${cell.s}` : 'כל הפריטים לפי ציון'}</h2>
          {cell && (
            <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCell(null)}>
              הצגת הכל
            </button>
          )}
          {shown.length === 0 ? (
            <p className="muted">אין פריטים.</p>
          ) : (
            <ul className="list-plain report-items">
              {shown.map((i) => (
                <li key={i.id}>
                  <button type="button" className="link-btn" onClick={() => onOpenItem(i.id)}>
                    {i.name}
                  </button>{' '}
                  <RiskPill value={i.values[col.id] as { l: number; s: number }} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
