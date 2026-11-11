import type { BoardDetail, Item } from '@suboard/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage } from '../../api/client';
import { useItemPersonal, useItemTemplates, usePersonalMutations } from '../../api/hooks';
import { Dialog } from '../../components/Dialog';
import { useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { formatDateTime } from './activityText';

/** Local "YYYY-MM-DDTHH:mm" for a datetime-local input. */
const toLocalInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** "For my eyes only" on an item: reminders and a private note. */
export function PersonalSection({ itemId }: { itemId: string }) {
  const q = useItemPersonal(itemId);
  const { addReminder, removeReminder, saveNote } = usePersonalMutations(itemId);
  const { toast } = useFeedback();
  const [when, setWhen] = useState('');
  const [remNote, setRemNote] = useState('');
  const [note, setNote] = useState('');
  useEffect(() => setNote(q.data?.note ?? ''), [q.data?.note]);
  const onErr = (e: unknown) => toast(errorMessage(e), 'error');

  const remind = (at: Date) =>
    addReminder.mutate(
      { remindAt: at.toISOString(), note: remNote.trim() },
      { onSuccess: (r) => (setWhen(''), setRemNote(''), toast(`תזכורת נקבעה ל-${formatDateTime(r.remindAt)}`)), onError: onErr },
    );
  const quick: [string, () => Date][] = [
    ['בעוד שעה', () => new Date(Date.now() + 3600_000)],
    [
      'מחר ב-8:00',
      () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(8, 0, 0, 0);
        return d;
      },
    ],
    [
      'בעוד שבוע',
      () => {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        d.setHours(8, 0, 0, 0);
        return d;
      },
    ],
  ];
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!when) return;
    remind(new Date(when));
  };
  const reminders = q.data?.reminders ?? [];

  return (
    <section aria-labelledby="personal-h" className="personal">
      <h3 id="personal-h">
        <Icon name="lock" size={16} /> רק בשבילי
      </h3>
      <p className="hint">תזכורות והערה אישית — גלויות רק לך. לא להזין מידע רגיש.</p>

      <div className="personal-block">
        <span className="label" id="rem-label">
          הזכר לי על הפריט
        </span>
        {reminders.length > 0 && (
          <ul className="list-plain reminder-list" aria-label="התזכורות שלי לפריט">
            {reminders.map((r) => (
              <li key={r.id}>
                <Icon name="bell" size={16} />
                <span>
                  <time dateTime={r.remindAt}>{formatDateTime(r.remindAt)}</time>
                  {r.note && <span className="muted"> · {r.note}</span>}
                </span>
                <button type="button" className="icon-btn" aria-label={`ביטול התזכורת של ${formatDateTime(r.remindAt)}`} onClick={() => removeReminder.mutate(r.id, { onSuccess: () => toast('התזכורת בוטלה'), onError: onErr })}>
                  <Icon name="x" size={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="date-shortcuts" role="group" aria-labelledby="rem-label">
          {quick.map(([text, at]) => (
            <button key={text} type="button" className="chip-btn" disabled={addReminder.isPending} onClick={() => remind(at())}>
              {text}
            </button>
          ))}
        </div>
        <form onSubmit={submit} className="reminder-form">
          <div className="field">
            <label htmlFor="rem-when">מועד אחר</label>
            <input id="rem-when" className="input" type="datetime-local" value={when} min={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} />
          </div>
          <div className="field grow">
            <label htmlFor="rem-note">על מה להזכיר (לא חובה)</label>
            <input id="rem-note" className="input" maxLength={200} value={remNote} onChange={(e) => setRemNote(e.target.value)} />
          </div>
          <button type="submit" className="btn btn-sm" disabled={!when || addReminder.isPending}>
            קביעת תזכורת
          </button>
        </form>
      </div>

      <div className="field">
        <label htmlFor="my-note">הערה אישית</label>
        <textarea
          id="my-note"
          className="textarea"
          rows={2}
          maxLength={2000}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => {
            if (note.trim() !== (q.data?.note ?? '')) saveNote.mutate(note, { onSuccess: () => toast('ההערה האישית נשמרה'), onError: onErr });
          }}
        />
      </div>
    </section>
  );
}

/** "Save as template" for an item and its sub-items. */
export function SaveItemTemplateButton({ item, subCount }: { item: Item; subCount: number }) {
  const { saveTemplate } = usePersonalMutations(item.id, item.boardId);
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(item.name.slice(0, 80));
  return (
    <>
      <button type="button" className="btn btn-sm" onClick={() => (setName(item.name.slice(0, 80)), setOpen(true))}>
        <Icon name="clipboard" /> שמירה כתבנית
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="שמירת הפריט כתבנית"
        footer={
          <>
            <button type="button" className="btn" onClick={() => setOpen(false)}>
              ביטול
            </button>
            <button type="submit" form="save-item-tpl" className="btn btn-primary" disabled={!name.trim() || saveTemplate.isPending}>
              {saveTemplate.isPending ? 'שומר…' : 'שמירה'}
            </button>
          </>
        }
      >
        <form
          id="save-item-tpl"
          onSubmit={(e) => {
            e.preventDefault();
            saveTemplate.mutate(name.trim(), { onSuccess: (t) => (setOpen(false), toast(`התבנית "${t.name}" נשמרה (${t.size} פריטים). צרו ממנה ב"פריט מתבנית" בראש הלוח.`)), onError: (err) => toast(errorMessage(err), 'error') });
          }}
        >
          <p className="muted">
            נשמרים שם הפריט, הערכים{subCount > 0 ? ` ו-${subCount} תת-הפריטים שלו` : ''}. <strong>לא נשמרים:</strong> אנשים, תאריכים, קבצים ועדכונים.
          </p>
          <div className="field">
            <label htmlFor="item-tpl-name">שם התבנית</label>
            <input id="item-tpl-name" className="input" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Board toolbar: create an item (with its sub-items) from a saved template. */
export function NewFromTemplate({ board, onCreated }: { board: BoardDetail; onCreated: (itemId: string) => void }) {
  const q = useItemTemplates(board.id);
  const { useTemplate, removeTemplate } = usePersonalMutations('', board.id);
  const { toast, confirm } = useFeedback();
  const [open, setOpen] = useState(false);
  const [groupId, setGroupId] = useState(board.groups[0]?.id ?? '');
  if (board.myRole === 'viewer' || !q.data || q.data.length === 0) return null;
  return (
    <>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        <Icon name="clipboard" /> פריט מתבנית
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="פריט חדש מתבנית">
        <div className="field">
          <label htmlFor="tpl-group">ייווצר בקבוצה</label>
          <select id="tpl-group" className="select" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
            {board.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <ul className="list-plain" aria-label="תבניות פריט">
          {q.data.map((t) => (
            <li key={t.id} className="tpl-row">
              <span style={{ flex: 1 }}>
                <strong>{t.name}</strong>
                <br />
                <small className="muted">
                  {t.size === 1 ? 'פריט אחד' : `${t.size} פריטים (כולל תת-פריטים)`}
                  {t.createdByName ? ` · ${t.createdByName}` : ''}
                </small>
              </span>
              <button
                type="button"
                className="btn btn-sm btn-primary"
                disabled={useTemplate.isPending}
                aria-label={`יצירה מהתבנית ${t.name}`}
                onClick={() => useTemplate.mutate({ templateId: t.id, groupId }, { onSuccess: (item) => (setOpen(false), toast(`נוצר "${item.name}" מהתבנית`), onCreated(item.id)), onError: (e) => toast(errorMessage(e), 'error') })}
              >
                יצירה
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label={`מחיקת התבנית ${t.name}`}
                onClick={async () => {
                  if (await confirm({ title: 'מחיקת תבנית', message: `למחוק את התבנית "${t.name}"? פריטים שכבר נוצרו ממנה לא ישתנו.`, confirmLabel: 'מחיקה', danger: true })) removeTemplate.mutate(t.id, { onSuccess: () => toast('התבנית נמחקה'), onError: (e) => toast(errorMessage(e), 'error') });
                }}
              >
                <Icon name="trash" size={16} />
              </button>
            </li>
          ))}
        </ul>
      </Dialog>
    </>
  );
}
