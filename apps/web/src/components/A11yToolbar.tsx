import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from './Icon';

/**
 * Accessibility helper panel. It complements — and does not replace — accessible markup.
 * Preferences are kept in localStorage (a per-device convenience, not a cookie).
 */
interface Prefs {
  size: 100 | 115 | 130;
  contrast: boolean;
  links: boolean;
  readable: boolean;
  motionOff: boolean;
}
const DEFAULTS: Prefs = { size: 100, contrast: false, links: false, readable: false, motionOff: false };
const KEY = 'suboard.a11y';

function load(): Prefs {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function apply(p: Prefs) {
  const root = document.documentElement;
  root.style.setProperty('--font-size', `${p.size}%`);
  root.toggleAttribute('data-contrast', p.contrast);
  if (p.contrast) root.setAttribute('data-contrast', 'high');
  root.toggleAttribute('data-links', p.links);
  if (p.links) root.setAttribute('data-links', 'highlight');
  root.toggleAttribute('data-font', p.readable);
  if (p.readable) root.setAttribute('data-font', 'readable');
  root.toggleAttribute('data-motion', p.motionOff);
  if (p.motionOff) root.setAttribute('data-motion', 'off');
}

export function A11yToolbar() {
  const [open, setOpen] = useState(false);
  const [prefs, setPrefs] = useState<Prefs>(load);
  const panelRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    apply(prefs);
    try {
      localStorage.setItem(KEY, JSON.stringify(prefs));
    } catch {
      /* storage unavailable — preferences apply for this page view only */
    }
  }, [prefs]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.querySelector<HTMLElement>('button')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  const toggle = (k: keyof Omit<Prefs, 'size'>) => setPrefs((p) => ({ ...p, [k]: !p[k] }));
  const sizes: Prefs['size'][] = [100, 115, 130];

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className="a11y-fab"
        aria-expanded={open}
        aria-controls="a11y-panel"
        aria-label="תפריט נגישות"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="a11y" size={24} />
      </button>
      {open && (
        <div id="a11y-panel" ref={panelRef} className="card a11y-panel" role="region" aria-label="התאמות נגישות">
          <h2>התאמות נגישות</h2>
          <div role="group" aria-label="גודל טקסט" className="segmented" style={{ marginBottom: '0.6rem' }}>
            {sizes.map((s) => (
              <button key={s} type="button" aria-pressed={prefs.size === s} onClick={() => setPrefs((p) => ({ ...p, size: s }))}>
                {s === 100 ? 'רגיל' : s === 115 ? 'גדול' : 'גדול מאוד'}
              </button>
            ))}
          </div>
          <button type="button" className="btn" aria-pressed={prefs.contrast} onClick={() => toggle('contrast')}>
            ניגודיות גבוהה
          </button>
          <button type="button" className="btn" aria-pressed={prefs.links} onClick={() => toggle('links')}>
            הדגשת קישורים
          </button>
          <button type="button" className="btn" aria-pressed={prefs.readable} onClick={() => toggle('readable')}>
            גופן קריא
          </button>
          <button type="button" className="btn" aria-pressed={prefs.motionOff} onClick={() => toggle('motionOff')}>
            עצירת אנימציות
          </button>
          <button type="button" className="btn btn-ghost" onClick={() => setPrefs(DEFAULTS)}>
            איפוס הגדרות
          </button>
          <p style={{ margin: '0.5rem 0 0' }}>
            <Link to="/accessibility" onClick={() => setOpen(false)}>
              הצהרת נגישות
            </Link>
          </p>
        </div>
      )}
    </>
  );
}
