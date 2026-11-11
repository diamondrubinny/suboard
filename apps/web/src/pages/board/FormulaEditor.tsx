import { FORMULA_FUNCTIONS, FORMULA_MAX_LENGTH, FORMULA_SOURCE_TYPES, formulaToDisplay, formulaToStored, validateFormula, type Column } from '@suboard/shared';
import { useId, useRef, useState } from 'react';

const EXAMPLES: [string, string][] = [
  ['{עלות} * {כמות}', 'מכפלה של שתי עמודות מספר'],
  ['DAYS({תאריך יעד}, TODAY())', 'כמה ימים נשארו עד התאריך (מספר שלילי — באיחור)'],
  ['IF({סטטוס} = "בוצע", "סגור", "פתוח")', 'טקסט לפי תנאי'],
  ['ROUND({עלות} * 1.18, 2)', 'עיגול לשתי ספרות'],
];

/** Text → stored formula for this board, or the problem to show the user. */
export function compileFormula(shown: string, columns: Column[]): { stored: string } | { error: string } {
  const text = shown.trim();
  if (!text) return { error: 'יש להזין נוסחה' };
  const { formula, unknown } = formulaToStored(text, columns);
  if (unknown.length) return { error: `לא נמצאה עמודה בשם "${unknown[0]}"` };
  const problem = validateFormula(formula, columns);
  return problem ? { error: problem } : { stored: formula };
}

/**
 * Formula text field with the board's columns as insert buttons. Columns are written by title
 * inside braces — {כותרת} — and stored by id, so renaming a column does not break the formula.
 */
export function FormulaEditor({ column, columns, saving, onSave }: { column?: Column; columns: Column[]; saving: boolean; onSave: (stored: string) => void }) {
  const [text, setText] = useState(column?.settings.formula ? formulaToDisplay(column.settings.formula, columns) : '');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);
  const id = useId();
  const sources = columns.filter((c) => (FORMULA_SOURCE_TYPES as readonly string[]).includes(c.type) && c.id !== column?.id);

  const insert = (snippet: string) => {
    const el = ref.current;
    const at = el?.selectionStart ?? text.length;
    const end = el?.selectionEnd ?? text.length;
    setText(text.slice(0, at) + snippet + text.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(at + snippet.length, at + snippet.length);
    });
  };
  const save = () => {
    const res = compileFormula(text, columns);
    if ('error' in res) return setError(res.error);
    setError(null);
    onSave(res.stored);
  };

  return (
    <fieldset className="formula-editor">
      <legend>{column ? `הנוסחה של "${column.title}"` : 'נוסחה'}</legend>
      <label htmlFor={id} className="sr-only">
        נוסחה
      </label>
      <textarea
        id={id}
        ref={ref}
        className="textarea"
        dir="ltr"
        rows={2}
        maxLength={FORMULA_MAX_LENGTH}
        value={text}
        spellCheck={false}
        aria-invalid={Boolean(error)}
        aria-describedby={`${id}-help${error ? ` ${id}-err` : ''}`}
        placeholder="{עלות} * {כמות}"
        onChange={(e) => (setText(e.target.value), setError(null))}
      />
      {error && (
        <span id={`${id}-err`} className="error" role="alert">
          {error}
        </span>
      )}
      <div role="group" aria-label="הוספת עמודה לנוסחה" className="chip-row">
        {sources.map((c) => (
          <button key={c.id} type="button" className="btn btn-sm" onClick={() => insert(`{${c.title}}`)}>
            {c.title}
          </button>
        ))}
        {sources.length === 0 && <span className="hint">אין עדיין בלוח עמודות שאפשר לחשב עליהן (מספר, תאריך, סטטוס…).</span>}
      </div>
      <details id={`${id}-help`}>
        <summary>איך כותבים נוסחה?</summary>
        <p className="hint">
          שם עמודה בסוגריים מסולסלים, פעולות חשבון (+ − * /), השוואות (&gt; &lt; = !=), טקסט במירכאות, ו-&amp; לחיבור טקסטים. תאריך הוא מספר ימים, ולכן הפרש בין תאריכים נותן ימים. תא ריק נותן תוצאה ריקה.
        </p>
        <p className="hint" dir="ltr" style={{ textAlign: 'start' }}>
          {Object.keys(FORMULA_FUNCTIONS).join(' · ')}
        </p>
        <ul className="list-plain">
          {EXAMPLES.map(([f, what]) => (
            <li key={f}>
              <code dir="ltr">{f}</code> — {what}
            </li>
          ))}
        </ul>
      </details>
      <div>
        <button type="button" className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
          {column ? 'שמירת הנוסחה' : 'הוספת עמודת נוסחה'}
        </button>
      </div>
    </fieldset>
  );
}
