import type { TrendPoint } from '@suboard/shared';
import { useId, useState } from 'react';

const W = 560;
const H = 220;
// RTL: time runs right → left (oldest on the right, like the Gantt); the value axis sits on the right.
const PAD = { top: 16, right: 34, bottom: 30, left: 72 };

/** Nice round axis maximum and 4–5 ticks. */
function ticks(max: number): number[] {
  if (max <= 4) return [0, 1, 2, 3, 4].filter((t) => t <= Math.max(4, max));
  const step = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000].find((s) => max / s <= 5) ?? Math.ceil(max / 5);
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let t = 0; t <= top; t += step) out.push(t);
  return out;
}

/**
 * Opened vs closed per period — two series on ONE axis (same unit). Identity is never colour alone:
 * legend + end labels, and "closed" is dashed. Hover / focus a period for exact values; a table
 * view carries the same data for screen readers and print.
 */
export function TrendChart({ points, title }: { points: TrendPoint[]; title: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();
  if (!points.length) return <p className="muted">אין נתונים.</p>;
  const max = Math.max(1, ...points.flatMap((p) => [p.created, p.closed]));
  const ys = ticks(max);
  const top = ys[ys.length - 1]!;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => W - PAD.right - (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH - (v / top) * innerH;
  const path = (key: 'created' | 'closed') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ');
  const last = points.length - 1;
  const totals = points.reduce((a, p) => ({ c: a.c + p.created, d: a.d + p.closed }), { c: 0, d: 0 });
  const summary = `${title}: סה"כ נפתחו ${totals.c}, נסגרו ${totals.d} ב-${points.length} תקופות. פירוט בטבלה.`;
  const step = innerW / Math.max(1, points.length - 1);

  return (
    <figure className="trend">
      <ul className="chart-legend" aria-hidden="true">
        <li>
          <span className="swatch swatch-1" /> נפתחו
        </li>
        <li>
          <span className="swatch swatch-2" /> נסגרו
        </li>
      </ul>
      <div className="trend-plot">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} aria-describedby={tableId} className="trend-svg">
          {ys.map((t) => (
            <g key={t}>
              <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
              <text className="axis" x={W - PAD.right + 6} y={y(t) + 4} textAnchor="start">
                {t}
              </text>
            </g>
          ))}
          {points.map((p, i) => (
            <text key={p.start} className="axis" x={x(i)} y={H - 8} textAnchor="middle">
              {points.length > 8 && i % 2 ? '' : p.label}
            </text>
          ))}
          {hover !== null && <line className="crosshair" x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} />}
          <path className="line line-1" d={path('created')} />
          <path className="line line-2" d={path('closed')} />
          {points.map((p, i) => (
            <g key={p.start}>
              <circle className="dot dot-1" cx={x(i)} cy={y(p.created)} r={4} />
              <circle className="dot dot-2" cx={x(i)} cy={y(p.closed)} r={4} />
            </g>
          ))}
          {/* Direct end labels (text in ink, the coloured dot beside it carries identity). */}
          <text className="end-label" x={x(last) - 8} y={y(points[last]!.created) + 4} textAnchor="end">
            נפתחו {points[last]!.created}
          </text>
          <text className="end-label" x={x(last) - 8} y={y(points[last]!.closed) + (points[last]!.closed === points[last]!.created ? 18 : 4)} textAnchor="end">
            נסגרו {points[last]!.closed}
          </text>
          {/* Hit targets wider than the marks: one per period. */}
          {points.map((p, i) => (
            <rect
              key={p.start}
              className="hit"
              x={x(i) - step / 2}
              y={PAD.top}
              width={Math.max(step, 24)}
              height={innerH}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        {hover !== null && (
          <div className="chart-tip" style={{ left: `${(x(hover) / W) * 100}%` }} role="status">
            <strong>{points[hover]!.label}</strong>
            <span>נפתחו: {points[hover]!.created}</span>
            <span>נסגרו: {points[hover]!.closed}</span>
            {points[hover]!.avgCloseDays !== null && <span>זמן סגירה ממוצע: {points[hover]!.avgCloseDays} ימים</span>}
          </div>
        )}
      </div>
      <details className="chart-table">
        <summary>הצגה כטבלה</summary>
        <table className="data-table" id={tableId}>
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col">תקופה</th>
              <th scope="col">נפתחו</th>
              <th scope="col">נסגרו</th>
              <th scope="col">זמן סגירה ממוצע (ימים)</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.start}>
                <th scope="row">{p.label}</th>
                <td className="num">{p.created}</td>
                <td className="num">{p.closed}</td>
                <td className="num">{p.avgCloseDays ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </figure>
  );
}
