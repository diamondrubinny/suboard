import type { BoardDetail } from '@suboard/shared';
import { useId, useState } from 'react';
import { errorMessage } from '../../api/client';
import { useDependencies, useSetDependencies } from '../../api/hooks';
import { useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';

/** "חסום ע"י" dependencies of an item (same board), editable by editors. */
export function DependenciesSection({ board, itemId, onOpenItem }: { board: BoardDetail; itemId: string; onOpenItem: (id: string) => void }) {
  const q = useDependencies(itemId);
  const set = useSetDependencies(itemId, board.id);
  const { toast } = useFeedback();
  const [pick, setPick] = useState('');
  const selId = useId();
  const canEdit = board.myRole !== 'viewer';
  if (q.isPending || q.isError) return null;
  const d = q.data;
  const current = d.blockedBy.map((b) => b.id);
  const candidates = board.items.filter((i) => !i.parentId && i.id !== itemId && !current.includes(i.id));
  const save = (next: string[], msg: string) => set.mutate(next, { onSuccess: () => toast(msg), onError: (e) => toast(errorMessage(e), 'error') });
  if (!canEdit && !d.blockedBy.length && !d.blocks.length) return null;

  return (
    <section className="links-section" aria-labelledby={`deps-${itemId}`}>
      <h3 id={`deps-${itemId}`}>תלויות</h3>
      {d.blockedBy.length > 0 && (
        <ul className="list-plain">
          {d.blockedBy.map((b) => (
            <li key={b.id} className="link-row">
              <span className="muted link-kind">חסום ע"י</span>
              <button type="button" className="link-btn" onClick={() => onOpenItem(b.id)}>
                {b.name}
              </button>
              {b.done ? <span className="badge success">הושלם</span> : <span className="badge danger">פתוח</span>}
              {canEdit && (
                <button type="button" className="icon-btn" aria-label={`הסרת התלות ב-${b.name}`} onClick={() => save(current.filter((x) => x !== b.id), 'התלות הוסרה')}>
                  <Icon name="x" size={16} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {d.blocks.length > 0 && (
        <p className="muted">
          חוסם את:{' '}
          {d.blocks.map((b, i) => (
            <span key={b.id}>
              {i > 0 && ', '}
              <button type="button" className="link-btn" onClick={() => onOpenItem(b.id)}>
                {b.name}
              </button>
            </span>
          ))}
        </p>
      )}
      {canEdit && candidates.length > 0 && (
        <div className="rule-add">
          <label htmlFor={selId} className="sr-only">
            פריט שחוסם את הפריט הזה
          </label>
          <select id={selId} className="select" value={pick} onChange={(e) => setPick(e.target.value)}>
            <option value="">— חסום ע"י… —</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-sm" disabled={!pick || set.isPending} onClick={() => (save([...current, pick], 'התלות נוספה'), setPick(''))}>
            <Icon name="plus" /> הוספת תלות
          </button>
        </div>
      )}
    </section>
  );
}
