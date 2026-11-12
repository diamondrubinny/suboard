import type { ItemLink } from '@suboard/shared';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { useItemLinks, useLinkMutations, useSearch } from '../../api/hooks';
import { useFeedback } from '../../components/Feedback';
import { StatusPill } from '../../components/StatusPill';

const kindText = (l: ItemLink) =>
  l.kind === 'related'
    ? 'קשור ל'
    : l.kind === 'checklist_capa'
      ? l.direction === 'out'
        ? 'פעולה מתקנת מצ\'קליסט'
        : 'נפתח מצ\'קליסט של'
      : l.direction === 'out'
        ? 'פעולה מתקנת מתחקיר'
        : 'נפתח מתחקיר של';

/**
 * Linked items, both directions: automatic links (checklist → corrective action, investigation →
 * action) and manual ones to any item the user can see, on this board or another.
 */
export function LinksSection({ itemId, boardId, canEdit }: { itemId: string; boardId: string; canEdit: boolean }) {
  const q = useItemLinks(itemId);
  const { add, remove } = useLinkMutations(itemId, boardId);
  const { toast } = useFeedback();
  const [text, setText] = useState('');
  const [term, setTerm] = useState('');
  const inputId = useId();
  useEffect(() => {
    const t = window.setTimeout(() => setTerm(text.trim()), 250);
    return () => window.clearTimeout(t);
  }, [text]);
  const search = useSearch(term);
  const linked = new Set((q.data ?? []).map((l) => l.item?.id));
  const hits = (search.data ?? []).filter((h, i, a) => h.itemId !== itemId && !linked.has(h.itemId) && a.findIndex((x) => x.itemId === h.itemId) === i).slice(0, 8);

  if (q.isPending || q.isError) return null;
  if (!q.data.length && !canEdit) return null;
  const status = term.length < 2 ? '' : search.isFetching ? 'מחפש…' : hits.length ? `${hits.length} פריטים נמצאו` : 'לא נמצאו פריטים מתאימים';

  return (
    <section className="links-section" aria-labelledby={`links-${itemId}`}>
      <h3 id={`links-${itemId}`}>פריטים מקושרים{q.data.length > 0 && <span className="muted"> ({q.data.length})</span>}</h3>
      {q.data.length > 0 && (
        <ul className="list-plain">
          {q.data.map((l) => (
            <li key={l.id} className="link-row">
              <span className="muted link-kind">{kindText(l)}</span>
              {l.item ? (
                <>
                  <Link to={`/boards/${l.item.boardId}?item=${l.item.id}`}>{l.item.name}</Link>
                  <span className="muted">({l.item.boardName})</span>
                  {l.item.statusLabel && <StatusPill label={l.item.statusLabel} color={l.item.statusColor} />}
                </>
              ) : (
                <span className="muted">פריט בלוח שאין לך גישה אליו</span>
              )}
              {canEdit && l.kind === 'related' && (
                <button
                  type="button"
                  className="btn btn-sm"
                  style={{ marginInlineStart: 'auto' }}
                  disabled={remove.isPending}
                  aria-label={`הסרה: הקישור אל ${l.item?.name ?? 'פריט בלוח אחר'}`}
                  onClick={() => remove.mutate(l.id, { onSuccess: () => toast('הקישור הוסר'), onError: (e) => toast(errorMessage(e), 'error') })}
                >
                  הסרה
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="field" style={{ marginBlockStart: 'var(--space-2)' }}>
          <label htmlFor={inputId}>קישור לפריט אחר</label>
          <input
            id={inputId}
            type="search"
            className="input"
            value={text}
            maxLength={100}
            autoComplete="off"
            placeholder="חיפוש לפי שם פריט, בכל הלוחות שלך…"
            aria-describedby={`${inputId}-status`}
            onChange={(e) => setText(e.target.value)}
          />
          <span id={`${inputId}-status`} className="hint" role="status" aria-live="polite">
            {status}
          </span>
          {term.length >= 2 && hits.length > 0 && (
            <ul className="list-plain" aria-label="תוצאות לקישור">
              {hits.map((h) => (
                <li key={h.itemId} className="link-row">
                  <span>
                    {h.itemName} <span className="muted">({h.boardName})</span>
                  </span>
                  <button
                    type="button"
                    className="btn btn-sm"
                    style={{ marginInlineStart: 'auto' }}
                    disabled={add.isPending}
                    aria-label={`קישור אל ${h.itemName}`}
                    onClick={() =>
                      add.mutate(h.itemId, {
                        onSuccess: () => {
                          toast(`קושר אל "${h.itemName}"`);
                          setText('');
                          setTerm('');
                        },
                        onError: (e) => toast(errorMessage(e), 'error'),
                      })
                    }
                  >
                    קישור
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
