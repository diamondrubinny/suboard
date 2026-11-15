import { useEffect, useState } from 'react';

interface Entry {
  id: string;
  title: string;
}

/**
 * "Jump to a section" for long pages: lists the page's sections (every `section[aria-labelledby]`
 * inside the given container) and scrolls to the chosen one, moving the keyboard focus to its
 * heading. The list is read from the page itself, so a section that is added, removed or switched
 * off by a module appears or disappears here without any extra wiring.
 */
export function SectionNav({ container, label }: { container: string; label: string }) {
  const [entries, setEntries] = useState<Entry[]>([]);
  useEffect(() => {
    const root = document.querySelector(container);
    if (!root) return;
    const read = () => {
      const next: Entry[] = [];
      for (const s of root.querySelectorAll<HTMLElement>('section[aria-labelledby]')) {
        const h = document.getElementById(s.getAttribute('aria-labelledby') ?? '');
        const title = h?.textContent?.trim();
        if (h && title) next.push({ id: h.id, title });
      }
      setEntries((prev) => (prev.map((e) => e.id + e.title).join('|') === next.map((e) => e.id + e.title).join('|') ? prev : next));
    };
    read();
    const mo = new MutationObserver(read);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [container]);

  if (entries.length < 3) return null;
  const go = (id: string) => {
    const h = document.getElementById(id);
    if (!h) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.getAttribute('data-motion') === 'off';
    h.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
    h.setAttribute('tabindex', '-1');
    h.focus({ preventScroll: true });
  };
  return (
    <nav className="section-nav" aria-label={label}>
      <ul className="list-plain">
        {entries.map((e) => (
          <li key={e.id}>
            {/* The name starts with the visible text (WCAG 2.5.3) and says what the chip does, so it is
                never confused with a button of the same name inside the section. */}
            <button type="button" className="section-nav-link" aria-label={`${e.title} — מעבר לחלק`} onClick={() => go(e.id)}>
              {e.title}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
