import type { ReactNode, RefObject } from 'react';

/**
 * Light formatting for updates, stored as plain text and rendered as React elements — never as
 * HTML, so there is nothing to sanitise:
 *
 *   **bold**   *italic*   `code`   - bullet   1. numbered   https://link
 *
 * Only http(s) links become links; everything else stays text.
 */
const INLINE = /(\*\*[^*\n]+\*\*|\*[^*\n]+\*|`[^`\n]+`|https?:\/\/[^\s<>"')\]]+)/g;

function inline(text: string, key: string): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    const k = `${key}-${i}`;
    if (/^\*\*[^*\n]+\*\*$/.test(part)) return <strong key={k}>{part.slice(2, -2)}</strong>;
    if (/^\*[^*\n]+\*$/.test(part)) return <em key={k}>{part.slice(1, -1)}</em>;
    if (/^`[^`\n]+`$/.test(part)) return <code key={k}>{part.slice(1, -1)}</code>;
    if (/^https?:\/\//.test(part)) {
      // Trailing punctuation belongs to the sentence, not to the address.
      const m = /^(.*?)([.,;:!?]*)$/.exec(part)!;
      let href: string | null = null;
      try {
        const u = new URL(m[1]!);
        if (u.protocol === 'https:' || u.protocol === 'http:') href = u.href;
      } catch {
        href = null;
      }
      if (!href) return part;
      return (
        <span key={k}>
          <a href={href} target="_blank" rel="noopener noreferrer nofollow">
            {m[1]}
            <span className="sr-only"> (נפתח בלשונית חדשה)</span>
          </a>
          {m[2]}
        </span>
      );
    }
    return part;
  });
}

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[] };

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-•]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d{1,3}[.)]\s+(.*)$/.exec(line);
    const last = out[out.length - 1];
    if (bullet) {
      if (last?.kind === 'ul') last.items.push(bullet[1]!);
      else out.push({ kind: 'ul', items: [bullet[1]!] });
    } else if (numbered) {
      if (last?.kind === 'ol') last.items.push(numbered[1]!);
      else out.push({ kind: 'ol', items: [numbered[1]!] });
    } else if (!line.trim()) {
      if (last?.kind === 'p' && last.lines.length) out.push({ kind: 'p', lines: [] });
    } else if (last?.kind === 'p') {
      last.lines.push(line);
    } else {
      out.push({ kind: 'p', lines: [line] });
    }
  }
  return out.filter((b) => (b.kind === 'p' ? b.lines.length > 0 : b.items.length > 0));
}

export function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className ? `${className} rich-text` : 'rich-text'}>
      {blocks(text).map((b, i) =>
        b.kind === 'p' ? (
          <p key={i}>
            {b.lines.map((l, j) => (
              <span key={j}>
                {j > 0 && <br />}
                {inline(l, `${i}-${j}`)}
              </span>
            ))}
          </p>
        ) : b.kind === 'ul' ? (
          <ul key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, `${i}-${j}`)}</li>
            ))}
          </ul>
        ) : (
          <ol key={i}>
            {b.items.map((it, j) => (
              <li key={j}>{inline(it, `${i}-${j}`)}</li>
            ))}
          </ol>
        ),
      )}
    </div>
  );
}

/** Formatting buttons for a textarea: wrap the selection, or start list lines. */
export function FormatBar({ target, value, onChange, label }: { target: RefObject<HTMLTextAreaElement | null>; value: string; onChange: (v: string) => void; label: string }) {
  const apply = (fn: (sel: string) => { text: string; from: number; to: number }) => {
    const el = target.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const r = fn(value.slice(start, end));
    onChange(value.slice(0, start) + r.text + value.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + r.from, start + r.to);
    });
  };
  const wrap = (mark: string, placeholder: string) => () =>
    apply((sel) => {
      const inner = sel || placeholder;
      return { text: `${mark}${inner}${mark}`, from: mark.length, to: mark.length + inner.length };
    });
  const list = (prefix: (n: number) => string) => () =>
    apply((sel) => {
      const lines = (sel || 'פריט').split('\n');
      const text = lines.map((l, i) => `${prefix(i + 1)}${l.replace(/^\s*([-•]|\d{1,3}[.)])\s+/, '')}`).join('\n');
      const lead = value.slice(0, target.current?.selectionStart ?? value.length);
      const nl = lead && !lead.endsWith('\n') ? '\n' : '';
      return { text: nl + text, from: nl.length + text.length, to: nl.length + text.length };
    });
  return (
    <div className="format-bar" role="toolbar" aria-label={label}>
      <button type="button" className="btn btn-sm" onClick={wrap('**', 'טקסט מודגש')} aria-label="מודגש">
        <strong>B</strong>
      </button>
      <button type="button" className="btn btn-sm" onClick={wrap('*', 'טקסט נטוי')} aria-label="נטוי">
        <em>I</em>
      </button>
      <button type="button" className="btn btn-sm" onClick={list(() => '- ')}>
        רשימת תבליטים
      </button>
      <button type="button" className="btn btn-sm" onClick={list((n) => `${n}. `)}>
        רשימה ממוספרת
      </button>
    </div>
  );
}
