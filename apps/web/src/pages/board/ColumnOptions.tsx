import type { BoardDetail, Column, ColumnSettings } from '@suboard/shared';
import { useId, useState } from 'react';

/**
 * Options of an existing column: a description for everyone; unit and decimals for numbers and
 * formulas; label and target for an action button. Saved together; other settings are untouched.
 */
export function ColumnOptions({ column, board, saving, onSave }: { column: Column; board: BoardDetail; saving: boolean; onSave: (settings: ColumnSettings) => void }) {
  const ids = useId();
  const [description, setDescription] = useState(column.settings.description ?? '');
  const [unit, setUnit] = useState(column.settings.unit ?? '');
  const [decimals, setDecimals] = useState(typeof column.settings.decimals === 'number' ? String(column.settings.decimals) : '');
  const statusCols = board.columns.filter((c) => c.type === 'status');
  const [label, setLabel] = useState(column.settings.button?.label ?? '');
  const [target, setTarget] = useState(column.settings.button?.columnId ?? statusCols[0]?.id ?? '');
  const targetCol = statusCols.find((c) => c.id === target);
  const [option, setOption] = useState(column.settings.button?.optionId ?? '');
  const [error, setError] = useState<string | null>(null);
  const numeric = column.type === 'number' || column.type === 'formula';

  const save = () => {
    const settings: ColumnSettings = { description: description.trim() };
    if (numeric) {
      settings.unit = unit.trim();
      settings.decimals = decimals === '' ? null : Number(decimals);
    }
    if (column.type === 'button') {
      if (!label.trim()) return setError('יש לתת שם לכפתור');
      if (!targetCol || !targetCol.settings.options?.some((o) => o.id === option)) return setError('יש לבחור עמודת סטטוס ותווית');
      settings.button = { label: label.trim(), columnId: targetCol.id, optionId: option };
    }
    setError(null);
    onSave(settings);
  };

  return (
    <fieldset className="formula-editor">
      <legend>אפשרויות העמודה "{column.title}"</legend>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
      <div className="field">
        <label htmlFor={`${ids}-d`}>תיאור (מוצג ליד כותרת העמודה ובחלון הפריט)</label>
        <input id={`${ids}-d`} className="input" maxLength={200} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="למשל: למלא רק אחרי אישור המנהל" />
      </div>
      {numeric && (
        <div className="time-manual-row">
          <div className="field">
            <label htmlFor={`${ids}-u`}>יחידה</label>
            <input id={`${ids}-u`} className="input" maxLength={8} value={unit} onChange={(e) => setUnit(e.target.value)} placeholder='₪ / ק"ג / %' aria-describedby={`${ids}-uh`} />
            <span id={`${ids}-uh`} className="hint">
              סימן מטבע מוצג לפני המספר; כל יחידה אחרת — אחריו.
            </span>
          </div>
          <div className="field">
            <label htmlFor={`${ids}-n`}>ספרות אחרי הנקודה</label>
            <select id={`${ids}-n`} className="select" value={decimals} onChange={(e) => setDecimals(e.target.value)}>
              <option value="">כפי שהוזן</option>
              {[0, 1, 2, 3, 4].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        </div>
      )}
      {column.type === 'button' &&
        (statusCols.length === 0 ? (
          <p className="hint">כפתור קובע תווית בעמודת סטטוס. הוסיפו קודם עמודת סטטוס ללוח.</p>
        ) : (
          <>
            <div className="field">
              <label htmlFor={`${ids}-l`}>מה כתוב על הכפתור?</label>
              <input id={`${ids}-l`} className="input" maxLength={30} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="למשל: סיימתי" />
            </div>
            <div className="time-manual-row">
              <div className="field">
                <label htmlFor={`${ids}-t`}>בלחיצה, לקבוע בעמודה</label>
                <select id={`${ids}-t`} className="select" value={target} onChange={(e) => (setTarget(e.target.value), setOption(''))}>
                  {statusCols.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor={`${ids}-o`}>את התווית</label>
                <select id={`${ids}-o`} className="select" value={option} onChange={(e) => setOption(e.target.value)}>
                  <option value="">— בחירה —</option>
                  {(targetCol?.settings.options ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </>
        ))}
      <div>
        <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
          שמירת האפשרויות
        </button>
      </div>
    </fieldset>
  );
}
