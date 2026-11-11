import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useBoards, useRecentBoards, useSearch } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { Dialog } from './Dialog';
import { Icon, type IconName } from './Icon';

interface Entry {
  key: string;
  group: 'recent' | 'pages' | 'boards' | 'items';
  label: string;
  sub?: string;
  icon: IconName;
  to: string;
}

const GROUP_LABEL: Record<Entry['group'], string> = { recent: 'נפתחו לאחרונה', pages: 'עמודים', boards: 'לוחות', items: 'פריטים ועדכונים' };

/** App pages reachable from the palette, filtered by the user's role (the server still enforces access). */
function pagesFor(role: string | undefined): { label: string; to: string; icon: IconName; keywords?: string }[] {
  const pages: { label: string; to: string; icon: IconName; keywords?: string; roles?: string[] }[] = [
    { label: 'לוח בקרה', to: '/', icon: 'home', keywords: 'בית ראשי' },
    { label: 'המשימות שלי', to: '/my-work', icon: 'checks', keywords: 'משימות שלי action items תת-פריטים' },
    { label: 'כל הלוחות', to: '/boards', icon: 'boards' },
    { label: 'דשבורדים', to: '/dashboards', icon: 'chart', keywords: 'גרפים' },
    { label: 'עומס צוות', to: '/workload', icon: 'users' },
    { label: 'מבט מנהל', to: '/reports/monthly', icon: 'history', keywords: 'דוח חודשי', roles: ['admin', 'manager'] },
    { label: 'הדרכות', to: role === 'member' ? '/trainings/me' : '/trainings', icon: 'school' },
    { label: 'נהלים', to: '/procedures', icon: 'clipboard' },
    { label: 'תאימות', to: '/compliance', icon: 'checks' },
    { label: 'טפסים ודיווחים', to: '/forms', icon: 'clipboard' },
    { label: 'הפרופיל שלי', to: '/profile', icon: 'user', keywords: 'סיסמה אימות דו-שלבי חיבורים מכשירים' },
    { label: 'ניהול משתמשים', to: '/admin/users', icon: 'users', roles: ['admin'] },
    { label: 'יומן אבטחה', to: '/admin/audit', icon: 'shield', roles: ['admin'] },
  ];
  return pages.filter((p) => !p.roles || (role && p.roles.includes(role)));
}

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));

/**
 * Command palette (Ctrl/⌘+K): pages, boards (favourites first) and a full-text search of items.
 * ARIA combobox + listbox: arrow keys move, Enter opens, Escape closes. "?" opens the shortcuts list.
 */
export function GlobalSearch() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [help, setHelp] = useState(false);
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const res = useSearch(q);
  const boards = useBoards();
  const recent = useRecentBoards(open);

  useEffect(() => {
    const t = window.setTimeout(() => setQ(text.trim()), 250);
    return () => window.clearTimeout(t);
  }, [text]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setHelp(false);
        setOpen(true);
      } else if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(e.target) && !document.querySelector('dialog[open]')) {
        e.preventDefault();
        setHelp(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const entries = useMemo<Entry[]>(() => {
    const needle = text.trim().toLowerCase();
    const match = (...s: (string | undefined)[]) => !needle || s.some((x) => x?.toLowerCase().includes(needle));
    const out: Entry[] = [];
    if (!needle) {
      for (const b of recent.data ?? []) out.push({ key: `r-${b.id}`, group: 'recent', label: b.name, icon: b.favorite ? 'star' : 'table', to: `/boards/${b.id}` });
    }
    for (const p of pagesFor(user?.role)) if (match(p.label, p.keywords)) out.push({ key: `p-${p.to}`, group: 'pages', label: p.label, icon: p.icon, to: p.to });
    if (needle) {
      const list = [...(boards.data ?? [])].sort((x, y) => Number(y.favorite) - Number(x.favorite));
      for (const b of list) if (match(b.name, b.description)) out.push({ key: `b-${b.id}`, group: 'boards', label: b.name, sub: b.favorite ? 'מועדף' : undefined, icon: b.favorite ? 'star' : 'table', to: `/boards/${b.id}` });
      if (q.length >= 2)
        (res.data ?? []).forEach((h, i) =>
          out.push({
            key: `i-${h.itemId}-${h.kind}-${i}`,
            group: 'items',
            label: h.itemName,
            sub: `${h.kind === 'update' ? 'עדכון · ' : ''}${h.boardName}${h.snippet !== h.itemName ? ` · ${h.snippet}` : ''}`,
            icon: h.kind === 'update' ? 'message' : 'clipboard',
            to: `/boards/${h.boardId}?item=${h.itemId}`,
          }),
        );
    }
    return out;
  }, [text, q, recent.data, boards.data, res.data, user?.role]);

  useEffect(() => setActive(0), [text, entries.length]);
  useEffect(() => {
    document.getElementById(`cmd-opt-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const close = () => {
    setOpen(false);
    setText('');
  };
  const go = (e: Entry | undefined) => {
    if (!e) return;
    close();
    navigate(e.to);
  };

  const status =
    text.trim().length === 1
      ? 'הקלידו עוד תו כדי לחפש גם בפריטים'
      : q.length >= 2 && res.isFetching
        ? 'מחפש…'
        : res.isError && q.length >= 2
          ? errorMessage(res.error)
          : `${entries.length} תוצאות`;

  let lastGroup: Entry['group'] | null = null;
  return (
    <>
      <button type="button" className="icon-btn" aria-label="חלון פקודות וחיפוש (Ctrl+K)" aria-keyshortcuts="Control+K Meta+K" onClick={() => setOpen(true)}>
        <Icon name="search" />
      </button>
      <Dialog open={open} onClose={close} title="מעבר מהיר וחיפוש" initialFocusRef={inputRef}>
        <label htmlFor="global-search" className="sr-only">
          לאן לעבור או מה לחפש
        </label>
        <input
          id="global-search"
          ref={inputRef}
          type="search"
          className="input"
          role="combobox"
          aria-expanded={entries.length > 0}
          aria-controls="cmd-list"
          aria-autocomplete="list"
          aria-activedescendant={entries.length ? `cmd-opt-${active}` : undefined}
          placeholder="עמוד, לוח, פריט או עדכון…"
          value={text}
          maxLength={100}
          aria-describedby="global-search-status"
          autoComplete="off"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActive((a) => (entries.length ? (a + 1) % entries.length : 0));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActive((a) => (entries.length ? (a - 1 + entries.length) % entries.length : 0));
            } else if (e.key === 'Home' && entries.length && !text) {
              e.preventDefault();
              setActive(0);
            } else if (e.key === 'Enter') {
              e.preventDefault();
              go(entries[active]);
            }
          }}
        />
        <p id="global-search-status" className="muted" role="status" aria-live="polite" style={{ margin: 'var(--space-2) 0' }}>
          {status}
        </p>
        <ul id="cmd-list" role="listbox" aria-label="תוצאות" className="list-plain cmd-list">
          {entries.map((e, i) => {
            const header = e.group !== lastGroup ? GROUP_LABEL[e.group] : null;
            lastGroup = e.group;
            return (
              <li
                key={e.key}
                id={`cmd-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className="cmd-option"
                data-group-start={header ? GROUP_LABEL[e.group] : undefined}
                onMouseMove={() => setActive(i)}
                onClick={() => go(e)}
              >
                {header && (
                  <span className="cmd-group" aria-hidden="true">
                    {header}
                  </span>
                )}
                <span className="cmd-row">
                  <Icon name={e.icon} size={16} filled={e.icon === 'star'} />
                  <span>
                    <span className="sr-only">{GROUP_LABEL[e.group]}: </span>
                    <strong>{e.label}</strong>
                    {e.sub && (
                      <>
                        <br />
                        <small className="muted">{e.sub}</small>
                      </>
                    )}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
        <p className="muted cmd-hint">
          <kbd>↑</kbd> <kbd>↓</kbd> מעבר · <kbd>Enter</kbd> פתיחה · <kbd>Esc</kbd> סגירה · <kbd>?</kbd> כל הקיצורים
        </p>
      </Dialog>
      <ShortcutsDialog open={help} onClose={() => setHelp(false)} />
    </>
  );
}

const SHORTCUTS: [string[], string][] = [
  [['Ctrl', 'K'], 'מעבר מהיר וחיפוש (ב-Mac: ⌘ K)'],
  [['?'], 'רשימת קיצורי המקלדת'],
  [['Esc'], 'סגירת חלון, תפריט או טופס תשובה'],
  [['↑', '↓'], 'מעבר בין תוצאות בחלון המעבר המהיר'],
  [['Enter'], 'פתיחת התוצאה המסומנת'],
  [['←', '→'], 'מעבר בין לשוניות (Home / End — הראשונה / האחרונה)'],
  [['Tab'], 'מעבר בין רכיבים; הקישור "דילוג לתוכן" מופיע ראשון'],
  [['←', '→'], 'על ידית רוחב העמודה בטבלה: הרחבה / הצרה (Home — רוחב ברירת מחדל)'],
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="קיצורי מקלדת">
      <table className="table shortcuts">
        <caption className="sr-only">קיצורי מקלדת</caption>
        <thead>
          <tr>
            <th scope="col">מקשים</th>
            <th scope="col">פעולה</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map(([keys, what]) => (
            <tr key={what}>
              <td dir="ltr" className="nowrap">
                {keys.map((k, i) => (
                  <span key={k}>
                    {i > 0 && ' '}
                    <kbd>{k}</kbd>
                  </span>
                ))}
              </td>
              <td>{what}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">הקיצורים אינם פעילים בזמן הקלדה בשדה טקסט.</p>
    </Dialog>
  );
}
