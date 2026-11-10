import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useSearch } from '../api/hooks';
import { Dialog } from './Dialog';
import { Icon } from './Icon';

/** Search across every board the user can see (items, text values, updates). Ctrl/⌘+K opens it. */
export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const res = useSearch(q);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(text.trim()), 250);
    return () => window.clearTimeout(t);
  }, [text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const go = (boardId: string, itemId: string) => {
    setOpen(false);
    setText('');
    navigate(`/boards/${boardId}?item=${itemId}`);
  };

  return (
    <>
      <button type="button" className="icon-btn" aria-label="חיפוש בכל הלוחות (Ctrl+K)" aria-keyshortcuts="Control+K" onClick={() => setOpen(true)}>
        <Icon name="search" />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="חיפוש בכל הלוחות" initialFocusRef={inputRef}>
        <label htmlFor="global-search" className="sr-only">
          מה לחפש
        </label>
        <input
          id="global-search"
          ref={inputRef}
          type="search"
          className="input"
          placeholder="שם פריט, תיאור, עדכון…"
          value={text}
          maxLength={100}
          aria-describedby="global-search-status"
          onChange={(e) => setText(e.target.value)}
        />
        <p id="global-search-status" className="muted" role="status" aria-live="polite" style={{ margin: 'var(--space-2) 0' }}>
          {q.length < 2 ? 'הקלידו לפחות 2 תווים' : res.isFetching ? 'מחפש…' : res.isError ? errorMessage(res.error) : `${res.data?.length ?? 0} תוצאות`}
        </p>
        <ul className="list-plain item-list">
          {res.data?.map((h, i) => (
            <li key={`${h.itemId}-${h.kind}-${i}`}>
              <button type="button" className="search-hit" onClick={() => go(h.boardId, h.itemId)}>
                <strong>{h.itemName}</strong>
                <span className="badge">{h.kind === 'update' ? 'עדכון' : 'פריט'}</span>
                <br />
                <small className="muted">
                  {h.boardName}
                  {h.snippet !== h.itemName && <> · {h.snippet}</>}
                </small>
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
