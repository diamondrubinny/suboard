import { MAX_RELATION_ITEMS, type Column, type RelatedItem } from '@suboard/shared';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { useBoardItemNames, useSetRelation } from '../../api/hooks';
import { Dialog } from '../Dialog';
import { useFeedback } from '../Feedback';

interface Props {
  column: Column;
  boardId: string;
  itemId: string;
  /** Connected items the viewer may see. */
  related: RelatedItem[];
  readOnly: boolean;
  label: string;
  mode: 'table' | 'drawer';
  id?: string;
}

/**
 * "Connect boards" cell: the items of another board this item is connected to (a fault → its
 * equipment). Shows their names; editors pick them from a searchable list of that board.
 */
export function RelationCell({ column, boardId, itemId, related, readOnly, label, mode, id }: Props) {
  const [open, setOpen] = useState(false);
  const names = related.map((r) => r.name).join(', ');
  const summary = related.length ? names : '—';

  const links = (
    <span className="relation-links">
      {related.map((r, i) => (
        <span key={r.id}>
          {i > 0 && ', '}
          <Link to={`/boards/${r.boardId}?item=${r.id}`}>{r.name}</Link>
        </span>
      ))}
      {related.length === 0 && <span aria-label="אין פריטים מחוברים">—</span>}
    </span>
  );

  if (readOnly)
    return (
      <span className="cell-readonly" id={id}>
        {links}
      </span>
    );
  return (
    <>
      {mode === 'table' ? (
        <button type="button" className="long-text-btn" id={id} onClick={() => setOpen(true)} aria-label={`${summary} — ${label}: בחירת פריטים מחוברים`} title={names || undefined}>
          {summary}
        </button>
      ) : (
        <span className="relation-drawer" id={id}>
          {links}
          <button type="button" className="btn btn-sm" onClick={() => setOpen(true)} aria-label={`בחירה: ${label}`}>
            בחירה
          </button>
        </span>
      )}
      {open && <RelationPicker column={column} boardId={boardId} itemId={itemId} related={related} label={label} onClose={() => setOpen(false)} />}
    </>
  );
}

function RelationPicker({ column, boardId, itemId, related, label, onClose }: Omit<Props, 'readOnly' | 'mode' | 'id'> & { onClose: () => void }) {
  const target = column.settings.relation?.boardId ?? '';
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const [picked, setPicked] = useState<RelatedItem[]>(related);
  const inputRef = useRef<HTMLInputElement>(null);
  const formId = useId();
  const { toast } = useFeedback();
  const save = useSetRelation(boardId);
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(text.trim()), 200);
    return () => window.clearTimeout(t);
  }, [text]);
  const q = useBoardItemNames(target, term);
  const pickedIds = new Set(picked.map((p) => p.id));
  const full = picked.length >= MAX_RELATION_ITEMS;
  const toggle = (it: { id: string; name: string }) =>
    setPicked((cur) => (cur.some((p) => p.id === it.id) ? cur.filter((p) => p.id !== it.id) : [...cur, { id: it.id, name: it.name, boardId: target }]));
  // Chosen items stay in the list even when the search no longer matches them.
  const options = [...picked.filter((p) => !(q.data ?? []).some((o) => o.id === p.id)), ...(q.data ?? [])].filter((o) => o.id !== itemId);

  return (
    <Dialog
      open
      onClose={onClose}
      title={`פריטים מחוברים: ${label}`}
      initialFocusRef={inputRef}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={save.isPending}
            onClick={() =>
              save.mutate(
                { itemId, columnId: column.id, itemIds: picked.map((p) => p.id) },
                { onSuccess: () => (toast(picked.length ? `חוברו ${picked.length} פריטים` : 'החיבור הוסר'), onClose()), onError: (e) => toast(errorMessage(e), 'error') },
              )
            }
          >
            שמירה
          </button>
        </>
      }
    >
      <div className="field">
        <label htmlFor={formId}>חיפוש בלוח המחובר</label>
        <input id={formId} ref={inputRef} type="search" className="input" value={text} maxLength={100} autoComplete="off" onChange={(e) => setText(e.target.value)} aria-describedby={`${formId}-s`} />
        <span id={`${formId}-s`} className="hint" role="status" aria-live="polite">
          {q.isError ? errorMessage(q.error) : q.isPending ? 'טוען…' : `${options.length} פריטים · נבחרו ${picked.length}${full ? ` (המרב: ${MAX_RELATION_ITEMS})` : ''}`}
        </span>
      </div>
      <ul className="list-plain relation-options" aria-label="פריטים לחיבור">
        {options.map((o) => (
          <li key={o.id}>
            <label className="check">
              <input type="checkbox" checked={pickedIds.has(o.id)} disabled={!pickedIds.has(o.id) && full} onChange={() => toggle(o)} /> {o.name}
            </label>
          </li>
        ))}
        {q.data && options.length === 0 && <li className="muted">לא נמצאו פריטים</li>}
      </ul>
    </Dialog>
  );
}
