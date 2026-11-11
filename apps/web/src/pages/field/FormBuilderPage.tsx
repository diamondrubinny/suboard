import { LIMITS, QUESTION_TYPE_LABELS, quickFormSchema, type BoardForm, type QuestionType } from '@suboard/shared';
import { useRef, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { useQuickForm } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import { Icon } from '../../components/Icon';
import { usePageTitle } from '../../components/Layout';
import { ShareFormDialog } from './ShareFormDialog';

interface Question {
  key: number;
  title: string;
  type: QuestionType;
  required: boolean;
  help: string;
  options: string[];
}
const TYPES = Object.keys(QUESTION_TYPE_LABELS) as QuestionType[];
const isChoice = (t: QuestionType) => t === 'choice' || t === 'multi_choice';

/** Ready-made starting points, so a useful form is one click away. */
const STARTERS: { label: string; name: string; nameLabel: string; description: string; photos: boolean; questions: Omit<Question, 'key'>[] }[] = [
  {
    label: 'דיווח מפגע',
    name: 'דיווח מפגע',
    nameLabel: 'מה ראית?',
    description: 'ראיתם משהו מסוכן? דווחו כאן ונטפל.',
    photos: true,
    questions: [
      { title: 'מיקום', type: 'text', required: true, help: 'בניין, קומה, חדר', options: [] },
      { title: 'סוג המפגע', type: 'choice', required: true, help: '', options: ['חשמל', 'אש', 'החלקה / נפילה', 'כימי', 'אחר'] },
      { title: 'פירוט', type: 'long_text', required: false, help: '', options: [] },
    ],
  },
  {
    label: 'בקשת שירות',
    name: 'בקשה ליחידת הבטיחות',
    nameLabel: 'נושא הבקשה',
    description: '',
    photos: false,
    questions: [
      { title: 'סוג הבקשה', type: 'choice', required: true, help: '', options: ['סקר בטיחות', 'הדרכה', 'ייעוץ', 'ציוד מגן', 'אחר'] },
      { title: 'תאריך רצוי', type: 'date', required: false, help: '', options: [] },
      { title: 'טלפון לחזרה', type: 'phone', required: false, help: '', options: [] },
      { title: 'פירוט', type: 'long_text', required: false, help: '', options: [] },
    ],
  },
  {
    label: 'משוב על הדרכה',
    name: 'משוב על הדרכה',
    nameLabel: 'שם ההדרכה',
    description: '',
    photos: false,
    questions: [
      { title: 'שביעות רצון כללית', type: 'rating', required: true, help: '', options: [] },
      { title: 'ההדרכה רלוונטית לעבודתי', type: 'yes_no', required: false, help: '', options: [] },
      { title: 'מה כדאי לשפר', type: 'long_text', required: false, help: '', options: [] },
    ],
  },
];

/** Form builder: name + questions → a responses board and a shareable form, in one save. */
export function FormBuilderPage() {
  usePageTitle('טופס חדש');
  const { user } = useAuth();
  const create = useQuickForm();
  const nextKey = useRef(1);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [nameLabel, setNameLabel] = useState('נושא');
  const [allowPhotos, setAllowPhotos] = useState(false);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ form: BoardForm; boardId: string } | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  if (user && user.role === 'member') return <Navigate to="/forms" replace />;

  const add = (type: QuestionType = 'text') => {
    const key = nextKey.current++;
    setQuestions((q) => [...q, { key, title: '', type, required: false, help: '', options: isChoice(type) ? ['', ''] : [] }]);
    requestAnimationFrame(() => document.getElementById(`q-title-${key}`)?.focus());
  };
  const patch = (key: number, p: Partial<Question>) => setQuestions((qs) => qs.map((q) => (q.key === key ? { ...q, ...p } : q)));
  const move = (i: number, d: -1 | 1) =>
    setQuestions((qs) => {
      const n = [...qs];
      const j = i + d;
      if (j < 0 || j >= n.length) return qs;
      [n[i], n[j]] = [n[j]!, n[i]!];
      return n;
    });
  const applyStarter = (s: (typeof STARTERS)[number]) => {
    setName(s.name);
    setDescription(s.description);
    setNameLabel(s.nameLabel);
    setAllowPhotos(s.photos);
    setQuestions(s.questions.map((q) => ({ ...q, key: nextKey.current++ })));
    setError(null);
  };

  const save = () => {
    const parsed = quickFormSchema.safeParse({
      name,
      description,
      nameLabel: nameLabel.trim() || 'נושא',
      allowPhotos,
      questions: questions.map((q) => ({ title: q.title, type: q.type, required: q.required, ...(q.help.trim() ? { help: q.help } : {}), ...(isChoice(q.type) ? { options: q.options.map((o) => o.trim()).filter(Boolean) } : {}) })),
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0]!;
      const qi = issue.path[0] === 'questions' && typeof issue.path[1] === 'number' ? issue.path[1] : null;
      const msg = issue.path[0] === 'name' ? 'יש לתת שם לטופס' : qi !== null ? `שאלה ${qi + 1}: ${issue.path[2] === 'title' ? 'חסרה כותרת לשאלה' : issue.message}` : issue.message;
      setError(msg);
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setError(null);
    create.mutate(parsed.data, { onSuccess: setDone, onError: (e) => (setError(errorMessage(e)), requestAnimationFrame(() => errorRef.current?.focus())) });
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>טופס חדש</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            בחרו שם, הוסיפו שאלות ושמרו — תקבלו קישור וקוד QR לשיתוף. כל תשובה נכנסת כפריט בלוח תשובות שנוצר אוטומטית.
          </p>
        </div>
        <div className="actions">
          <Link to="/forms" className="btn">
            ביטול
          </Link>
          <button type="button" className="btn btn-primary" disabled={create.isPending} onClick={save}>
            {create.isPending ? 'יוצר…' : 'שמירה וקבלת קישור'}
          </button>
        </div>
      </div>

      <div className="builder">
        <div className="builder-edit">
          {questions.length === 0 && !name && (
            <section className="card" aria-labelledby="starters-h">
              <h2 id="starters-h">התחלה מהירה</h2>
              <p className="muted">בחרו תבנית מוכנה ושנו לפי הצורך, או התחילו מטופס ריק.</p>
              <div className="toolbar">
                {STARTERS.map((s) => (
                  <button key={s.label} type="button" className="btn" onClick={() => applyStarter(s)}>
                    {s.label}
                  </button>
                ))}
              </div>
            </section>
          )}
          {error && (
            <div className="form-error" role="alert" tabIndex={-1} ref={errorRef}>
              {error}
            </div>
          )}
          <section className="card" aria-labelledby="fb-details">
            <h2 id="fb-details">פרטי הטופס</h2>
            <div className="field">
              <label htmlFor="fb-name">שם הטופס</label>
              <input id="fb-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: דיווח מפגע" />
            </div>
            <div className="field">
              <label htmlFor="fb-desc">הסבר למילוי (לא חובה)</label>
              <textarea id="fb-desc" className="textarea" rows={2} maxLength={1000} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="fb-namelabel">השאלה הראשונה (כותרת הפנייה)</label>
              <input id="fb-namelabel" className="input" maxLength={80} value={nameLabel} onChange={(e) => setNameLabel(e.target.value)} aria-describedby="fb-namelabel-hint" />
              <span id="fb-namelabel-hint" className="hint">
                תמיד חובה. התשובה הופכת לשם הפריט בלוח התשובות.
              </span>
            </div>
            <label className="check">
              <input type="checkbox" checked={allowPhotos} onChange={(e) => setAllowPhotos(e.target.checked)} /> לאפשר צירוף עד {LIMITS.formPhotos} תמונות (נסרקות לאיתור נוזקות)
            </label>
          </section>

          <section aria-labelledby="fb-questions">
            <h2 id="fb-questions">
              שאלות <span className="badge">{questions.length}</span>
            </h2>
            <ol className="list-plain question-list">
              {questions.map((q, i) => (
                <li key={q.key} className="card question-card">
                  <fieldset>
                    <legend className="sr-only">
                      שאלה {i + 1}: {q.title || 'ללא כותרת'}
                    </legend>
                    <div className="question-head">
                      <span className="question-num" aria-hidden="true">
                        {i + 1}
                      </span>
                      <div className="field grow">
                        <label htmlFor={`q-title-${q.key}`}>השאלה</label>
                        <input id={`q-title-${q.key}`} className="input" maxLength={LIMITS.columnTitle} value={q.title} onChange={(e) => patch(q.key, { title: e.target.value })} />
                      </div>
                      <div className="field">
                        <label htmlFor={`q-type-${q.key}`}>סוג תשובה</label>
                        <select
                          id={`q-type-${q.key}`}
                          className="select"
                          value={q.type}
                          onChange={(e) => {
                            const type = e.target.value as QuestionType;
                            patch(q.key, { type, options: isChoice(type) ? (q.options.length ? q.options : ['', '']) : [] });
                          }}
                        >
                          {TYPES.map((t) => (
                            <option key={t} value={t}>
                              {QUESTION_TYPE_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    {isChoice(q.type) && (
                      <div className="question-options" role="group" aria-label={`אפשרויות לשאלה ${i + 1}`}>
                        {q.options.map((o, oi) => (
                          <div key={oi} className="option-line">
                            <input
                              className="input"
                              aria-label={`אפשרות ${oi + 1}`}
                              placeholder={`אפשרות ${oi + 1}`}
                              maxLength={40}
                              value={o}
                              onChange={(e) => patch(q.key, { options: q.options.map((x, xi) => (xi === oi ? e.target.value : x)) })}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  patch(q.key, { options: [...q.options, ''] });
                                }
                              }}
                            />
                            <button type="button" className="icon-btn" aria-label={`מחיקת אפשרות ${oi + 1}`} disabled={q.options.length <= 2} onClick={() => patch(q.key, { options: q.options.filter((_, xi) => xi !== oi) })}>
                              <Icon name="x" size={16} />
                            </button>
                          </div>
                        ))}
                        <button type="button" className="btn btn-ghost btn-sm" disabled={q.options.length >= LIMITS.statusOptions} onClick={() => patch(q.key, { options: [...q.options, ''] })}>
                          <Icon name="plus" size={16} /> אפשרות נוספת
                        </button>
                      </div>
                    )}
                    <div className="field">
                      <label htmlFor={`q-help-${q.key}`}>הסבר לממלא (לא חובה)</label>
                      <input id={`q-help-${q.key}`} className="input" maxLength={300} value={q.help} onChange={(e) => patch(q.key, { help: e.target.value })} />
                    </div>
                    <div className="question-foot">
                      <label className="check">
                        <input type="checkbox" checked={q.required} onChange={(e) => patch(q.key, { required: e.target.checked })} /> חובה
                      </label>
                      <span className="grow" />
                      <button type="button" className="icon-btn" aria-label={`הזזת שאלה ${i + 1} למעלה`} disabled={i === 0} onClick={() => move(i, -1)}>
                        <span style={{ display: 'inline-flex', transform: 'rotate(180deg)' }}>
                          <Icon name="chevronDown" />
                        </span>
                      </button>
                      <button type="button" className="icon-btn" aria-label={`הזזת שאלה ${i + 1} למטה`} disabled={i === questions.length - 1} onClick={() => move(i, 1)}>
                        <Icon name="chevronDown" />
                      </button>
                      <button type="button" className="icon-btn" aria-label={`מחיקת שאלה ${i + 1}`} onClick={() => setQuestions((qs) => qs.filter((x) => x.key !== q.key))}>
                        <Icon name="trash" />
                      </button>
                    </div>
                  </fieldset>
                </li>
              ))}
            </ol>
            <div className="add-question" role="group" aria-label="הוספת שאלה">
              <button type="button" className="btn btn-primary" disabled={questions.length >= LIMITS.formFields} onClick={() => add('text')}>
                <Icon name="plus" /> הוספת שאלה
              </button>
              {(['choice', 'long_text', 'date', 'yes_no'] as QuestionType[]).map((t) => (
                <button key={t} type="button" className="chip-btn" disabled={questions.length >= LIMITS.formFields} onClick={() => add(t)}>
                  + {QUESTION_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </section>
        </div>

        <aside className="card builder-preview" aria-labelledby="fb-preview">
          <h2 id="fb-preview">תצוגה מקדימה</h2>
          <div className="preview-form" inert>
            <h3>{name || 'שם הטופס'}</h3>
            {description && <p className="muted">{description}</p>}
            <PreviewField label={`${nameLabel || 'נושא'} *`}>
              <span className="input preview-input" />
            </PreviewField>
            {questions.map((q) => (
              <PreviewField key={q.key} label={`${q.title || 'שאלה ללא כותרת'}${q.required ? ' *' : ''}`} help={q.help}>
                {q.type === 'long_text' ? (
                  <span className="textarea preview-input tall" />
                ) : isChoice(q.type) ? (
                  <span className="preview-options">
                    {q.options.filter((o) => o.trim()).map((o, oi) => (
                      <span key={oi} className="chip-btn">
                        {o}
                      </span>
                    ))}
                  </span>
                ) : q.type === 'yes_no' ? (
                  <span className="check">
                    <input type="checkbox" tabIndex={-1} readOnly /> כן
                  </span>
                ) : q.type === 'rating' ? (
                  <span aria-hidden="true">☆ ☆ ☆ ☆ ☆</span>
                ) : (
                  <span className="input preview-input" />
                )}
              </PreviewField>
            ))}
            {allowPhotos && <p className="muted">📷 צירוף תמונות</p>}
            <span className="btn btn-primary">שליחה</span>
          </div>
        </aside>
      </div>

      <ShareFormDialog form={done?.form ?? null} created onClose={() => setDone(null)}>
        {done && (
          <Link to={`/boards/${done.boardId}`} className="btn">
            ללוח התשובות
          </Link>
        )}
      </ShareFormDialog>
      {done === null && create.isSuccess && <Navigate to="/forms" replace />}
    </>
  );
}

function PreviewField({ label, help, children }: { label: string; help?: string; children: React.ReactNode }) {
  return (
    <div className="field">
      <span className="label">{label}</span>
      {children}
      {help && <span className="hint">{help}</span>}
    </div>
  );
}
