import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon';

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO (yyyy-mm-dd) → dd/mm/yyyy. */
export function isoToDisplay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/**
 * What a person typed → ISO, or `null` when it is not a real date. Accepts dd/mm/yyyy with `/`, `.`
 * or `-`, one-digit day / month, a two-digit year (20yy), eight digits in a row, and an ISO date.
 */
export function parseDisplayDate(text: string): string | null {
  const t = text.trim();
  let d: number, m: number, y: number;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (r) [y, m, d] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})$/.exec(t))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else if ((r = /^(\d{2})(\d{2})(\d{4})$/.exec(t))) [d, m, y] = [Number(r[1]), Number(r[2]), Number(r[3])];
  else return null;
  if (y < 100) y += 2000;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (y < 1900 || y > 2200 || date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

export interface DateFieldProps {
  /** ISO date (yyyy-mm-dd) or '' for none. */
  value: string;
  /** Called with an ISO date, or '' when the field was cleared. Never called with an invalid date. */
  onChange: (iso: string) => void;
  id?: string;
  className?: string;
  'aria-label'?: string;
  'aria-describedby'?: string;
  min?: string;
  max?: string;
  disabled?: boolean;
  required?: boolean;
}

/**
 * Date input that always reads dd/mm/yyyy, whatever the browser's language (the native control
 * follows the browser, so an English browser shows mm/dd/yyyy). Type the date, or open the
 * browser's own calendar with the button; the value is committed on blur / Enter / calendar pick.
 */
export function DateField({ value, onChange, id, className = 'input', min, max, disabled, required, ...aria }: DateFieldProps) {
  const [text, setText] = useState(isoToDisplay(value));
  const [invalid, setInvalid] = useState<string | null>(null);
  const native = useRef<HTMLInputElement>(null);
  useEffect(() => {
    setText(isoToDisplay(value));
    setInvalid(null);
  }, [value]);

  const commit = () => {
    const t = text.trim();
    if (!t) {
      setInvalid(null);
      if (value) onChange('');
      return;
    }
    const iso = parseDisplayDate(t);
    if (!iso) return setInvalid('תאריך לא תקין — יש להקליד יום/חודש/שנה, למשל 21/11/2026');
    if ((min && iso < min) || (max && iso > max)) return setInvalid(min && iso < min ? `התאריך מוקדם מדי (מ-${isoToDisplay(min)})` : `התאריך מאוחר מדי (עד ${isoToDisplay(max)})`);
    setInvalid(null);
    setText(isoToDisplay(iso));
    if (iso !== value) onChange(iso);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape' && text !== isoToDisplay(value)) {
      e.stopPropagation();
      setText(isoToDisplay(value));
      setInvalid(null);
    }
  };
  const errId = id ? `${id}-date-error` : undefined;
  const describedBy = [aria['aria-describedby'], invalid ? errId : ''].filter(Boolean).join(' ') || undefined;

  return (
    <span className="date-field">
      <input
        id={id}
        className={className}
        type="text"
        inputMode="numeric"
        dir="ltr"
        autoComplete="off"
        placeholder="dd/mm/yyyy"
        maxLength={10}
        value={text}
        disabled={disabled}
        required={required}
        aria-label={aria['aria-label']}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        title={invalid ?? 'יום/חודש/שנה'}
        onChange={(e) => {
          // Digits typed in a row get their slashes: 21112026 → 21/11/2026.
          const raw = e.target.value;
          const grew = raw.length > text.length;
          const next = grew && /^\d{2}$/.test(raw) ? `${raw}/` : grew && /^\d{2}\/\d{2}$/.test(raw) ? `${raw}/` : raw;
          setText(next);
          setInvalid(null);
          // A complete date is committed as it is typed (like the native control), so nothing changes —
          // and nothing on the page moves — when the field is left by clicking a button.
          if (/^\d{2}\/\d{2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/.test(next)) {
            const iso = parseDisplayDate(next);
            if (iso && iso !== value && !(min && iso < min) && !(max && iso > max)) onChange(iso);
          }
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      <button
        type="button"
        className="icon-btn date-field-btn"
        disabled={disabled}
        aria-label={`בחירה מלוח שנה${aria['aria-label'] ? `: ${aria['aria-label']}` : ''}`}
        onClick={() => {
          const el = native.current;
          if (!el) return;
          try {
            el.showPicker();
          } catch {
            el.focus();
          }
        }}
      >
        <Icon name="calendar" size={16} />
      </button>
      {/* The browser's calendar, without its own text field: opened by the button above. */}
      <input
        ref={native}
        type="date"
        className="date-field-native"
        tabIndex={-1}
        aria-hidden="true"
        value={value || ''}
        min={min}
        max={max}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      {invalid && (
        <span id={errId} className="error date-field-error" role="alert">
          {invalid}
        </span>
      )}
    </span>
  );
}
