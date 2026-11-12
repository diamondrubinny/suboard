import { BUTTON_ACTIONS, type BoardDetail, type ButtonAction, type Column, type ColumnSettings } from '@suboard/shared';
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
  const [label, setLabel] = useState(column.settings.button?.label ?? '');
  const [action, setAction] = useState<ButtonAction>(column.settings.button?.action ?? 'set_status');
  const need = BUTTON_ACTIONS[action].columnType;
  const candidates = need ? board.columns.filter((c) => c.type === need) : [];
  const [target, setTarget] = useState(column.settings.button?.columnId ?? '');
  const targetCol = candidates.find((c) => c.id === target) ?? candidates[0];
  const [option, setOption] = useState(column.settings.button?.optionId ?? '');
  const [group, setGroup] = useState(column.settings.button?.groupId ?? board.groups[0]?.id ?? '');
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
      if (need && !targetCol) return setError('אין בלוח עמודה מתאימה לפעולה הזו');
      if (action === 'set_status' && !targetCol!.settings.options?.some((o) => o.id === option)) return setError('יש לבחור תווית');
      if (action === 'move_group' && !group) return setError('יש לבחור קבוצה');
      settings.button = { label: label.trim(), action, ...(need ? { columnId: targetCol!.id } : { groupId: group }), ...(action === 'set_status' ? { optionId: option } : {}) };
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
      {column.type === 'button' && (
        <>
          <div className="field">
            <label htmlFor={`${ids}-l`}>מה כתוב על הכפתור?</label>
            <input id={`${ids}-l`} className="input" maxLength={30} value={label} onChange={(e) => setLabel(e.target.value)} placeholder="למשל: סיימתי" />
          </div>
          <div className="field">
            <label htmlFor={`${ids}-a`}>מה הלחיצה עושה?</label>
            <select id={`${ids}-a`} className="select" value={action} onChange={(e) => (setAction(e.target.value as ButtonAction), setTarget(''), setOption(''))}>
              {(Object.keys(BUTTON_ACTIONS) as ButtonAction[]).map((a) => (
                <option key={a} value={a}>
                  {BUTTON_ACTIONS[a].label}
                </option>
              ))}
            </select>
          </div>
          {need && candidates.length === 0 && <p className="hint">אין בלוח עמודה מהסוג שהפעולה צריכה. הוסיפו עמודה מתאימה ואז חזרו לכאן.</p>}
          <div className="time-manual-row">
            {need && candidates.length > 0 && (
              <div className="field">
                <label htmlFor={`${ids}-t`}>בעמודה</label>
                <select id={`${ids}-t`} className="select" value={targetCol?.id ?? ''} onChange={(e) => (setTarget(e.target.value), setOption(''))}>
                  {candidates.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {action === 'set_status' && targetCol && (
              <div className="field">
                <label htmlFor={`${ids}-o`}>את התווית</label>
                <select id={`${ids}-o`} className="select" value={option} onChange={(e) => setOption(e.target.value)}>
                  <option value="">— בחירה —</option>
                  {(targetCol.settings.options ?? []).map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            {action === 'move_group' && (
              <div className="field">
                <label htmlFor={`${ids}-g`}>לקבוצה</label>
                <select id={`${ids}-g`} className="select" value={group} onChange={(e) => setGroup(e.target.value)}>
                  {board.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </>
      )}
      <div>
        <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
          שמירת האפשרויות
        </button>
      </div>
    </fieldset>
  );
}
