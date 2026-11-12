import { COLUMN_TYPE_LABELS, type BoardDetail, type ColumnSettings } from '@suboard/shared';
import { useId, useState } from 'react';
import { useBoard, useBoards } from '../../api/hooks';

const NOT_MIRRORABLE = ['relation', 'mirror', 'linked', 'checklist'];

/** Settings of a new "connect boards" column (which board) or mirror column (which connection, which column). */
export function RelationSetup({ kind, board, saving, onSave }: { kind: 'relation' | 'mirror'; board: BoardDetail; saving: boolean; onSave: (settings: ColumnSettings) => void }) {
  const ids = useId();
  const boards = useBoards();
  const relationCols = board.columns.filter((c) => c.type === 'relation' && c.settings.relation);
  const [targetBoard, setTargetBoard] = useState('');
  const [relCol, setRelCol] = useState(relationCols[0]?.id ?? '');
  const [targetCol, setTargetCol] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mirrorBoardId = relationCols.find((c) => c.id === relCol)?.settings.relation?.boardId ?? '';
  const target = useBoard(kind === 'mirror' ? mirrorBoardId : '');
  const candidates = (target.data?.columns ?? []).filter((c) => !NOT_MIRRORABLE.includes(c.type));

  const save = () => {
    if (kind === 'relation') {
      if (!targetBoard) return setError('יש לבחור לוח');
      setError(null);
      return onSave({ relation: { boardId: targetBoard } });
    }
    if (!relCol) return setError('יש לבחור עמודת חיבור');
    if (!targetCol) return setError('יש לבחור איזו עמודה להציג');
    setError(null);
    onSave({ mirror: { relationColumnId: relCol, targetColumnId: targetCol } });
  };

  return (
    <fieldset className="formula-editor">
      <legend>{kind === 'relation' ? 'חיבור ללוח אחר' : 'עמודת מראה'}</legend>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
      {kind === 'relation' ? (
        <div className="field">
          <label htmlFor={`${ids}-b`}>לאיזה לוח לחבר?</label>
          <select id={`${ids}-b`} className="select" value={targetBoard} onChange={(e) => setTargetBoard(e.target.value)} aria-describedby={`${ids}-bh`}>
            <option value="">— בחירה —</option>
            {(boards.data ?? [])
              .filter((b) => b.id !== board.id)
              .map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
          </select>
          <span id={`${ids}-bh`} className="hint">
            בכל פריט אפשר יהיה לבחור פריטים מהלוח הזה (למשל: תקלה ← פריט הציוד שלה). מי שאין לו גישה ללוח המחובר לא יראה את שמות הפריטים.
          </span>
        </div>
      ) : relationCols.length === 0 ? (
        <p className="hint">כדי להוסיף עמודת מראה צריך קודם עמודה מסוג "חיבור ללוח אחר" בלוח הזה.</p>
      ) : (
        <>
          <div className="field">
            <label htmlFor={`${ids}-r`}>דרך איזו עמודת חיבור?</label>
            <select id={`${ids}-r`} className="select" value={relCol} onChange={(e) => (setRelCol(e.target.value), setTargetCol(''))}>
              {relationCols.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor={`${ids}-t`}>איזו עמודה של הפריט המחובר להציג?</label>
            <select id={`${ids}-t`} className="select" value={targetCol} onChange={(e) => setTargetCol(e.target.value)} disabled={!target.data}>
              <option value="">{target.isPending && mirrorBoardId ? 'טוען…' : '— בחירה —'}</option>
              {candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title} ({COLUMN_TYPE_LABELS[c.type]})
                </option>
              ))}
            </select>
          </div>
        </>
      )}
      <div>
        <button type="button" className="btn btn-primary btn-sm" disabled={saving || (kind === 'mirror' && relationCols.length === 0)} onClick={save}>
          {kind === 'relation' ? 'הוספת עמודת חיבור' : 'הוספת עמודת מראה'}
        </button>
      </div>
    </fieldset>
  );
}
