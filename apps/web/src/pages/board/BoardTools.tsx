import { isReadonlyColumnType, findPrimaryStatusColumn, type BoardDetail, type DirectoryUser, type ImportResult, type SavedView, type ViewConfig, canEditColumn } from '@suboard/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { errorMessage } from '../../api/client';
import { useItemActions, useTrash, useViewMutations, useViews } from '../../api/hooks';
import { Dialog } from '../../components/Dialog';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { formatDateTime } from './activityText';
import { convertCell, readSpreadsheet } from './importParse';

// ============================================================ bulk bar
export function BulkBar({ board, selected, onClear }: { board: BoardDetail; selected: Set<string>; onClear: () => void }) {
  const { bulk, restore } = useItemActions(board.id);
  const { toast, confirm } = useFeedback();
  const status = findPrimaryStatusColumn(board.columns);
  const ids = [...selected];
  if (!ids.length) return null;
  const run = (input: Parameters<typeof bulk.mutate>[0], done: string) =>
    bulk.mutate(input, { onSuccess: (r) => (toast(`${done} (${r.affected})`), onClear()), onError: (e) => toast(errorMessage(e), 'error') });

  return (
    <div className="bulk-bar card" role="region" aria-label="פעולות על פריטים נבחרים">
      <strong aria-live="polite">נבחרו {ids.length}</strong>
      {status && (
        <>
          <label htmlFor="bulk-status" className="sr-only">
            שינוי {status.title}
          </label>
          <select
            id="bulk-status"
            className="select"
            value=""
            onChange={(e) => e.target.value && run({ action: 'set_value', itemIds: ids, columnId: status.id, value: e.target.value === '__clear' ? null : e.target.value }, `${status.title} עודכן`)}
          >
            <option value="">שינוי {status.title}…</option>
            {status.settings.options?.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
            <option value="__clear">ניקוי</option>
          </select>
        </>
      )}
      <label htmlFor="bulk-group" className="sr-only">
        העברה לקבוצה
      </label>
      <select id="bulk-group" className="select" value="" onChange={(e) => e.target.value && run({ action: 'move_group', itemIds: ids, groupId: e.target.value }, 'הועברו')}>
        <option value="">העברה לקבוצה…</option>
        {board.groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-danger btn-sm"
        onClick={async () => {
          if (!(await confirm({ title: 'מחיקת פריטים', message: `להעביר ${ids.length} פריטים לסל המחזור? אפשר לשחזר אותם במשך 30 יום.`, confirmLabel: 'מחיקה', danger: true }))) return;
          bulk.mutate(
            { action: 'delete', itemIds: ids },
            {
              onSuccess: (r) => {
                onClear();
                toast(`${r.affected} פריטים הועברו לסל המחזור`, 'info', { label: 'ביטול', onClick: () => ids.forEach((id) => restore.mutate(id)) }, 'undo');
              },
              onError: (e) => toast(errorMessage(e), 'error'),
            },
          );
        }}
      >
        <Icon name="trash" size={16} /> מחיקה
      </button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
        ניקוי בחירה
      </button>
    </div>
  );
}

// ============================================================ disclosure helper
function useDisclosure() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLElement>('.popover input, .popover button, .popover select')?.focus();
    const down = (e: MouseEvent) => !rootRef.current?.contains(e.target as Node) && setOpen(false);
    const key = (e: KeyboardEvent) => e.key === 'Escape' && (setOpen(false), btnRef.current?.focus());
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => (document.removeEventListener('mousedown', down), document.removeEventListener('keydown', key));
  }, [open]);
  return { open, setOpen, rootRef, btnRef };
}

// ============================================================ columns menu
export function ColumnsMenu({ board, hidden, onChange }: { board: BoardDetail; hidden: string[]; onChange: (hidden: string[]) => void }) {
  const d = useDisclosure();
  const id = useId();
  return (
    <div className="person-cell" ref={d.rootRef}>
      <button ref={d.btnRef} type="button" className="btn btn-sm" aria-expanded={d.open} aria-controls={id} onClick={() => d.setOpen((o) => !o)}>
        <Icon name="grid" size={16} /> עמודות{hidden.length ? ` (${hidden.length} מוסתרות)` : ''}
      </button>
      {d.open && (
        <div className="popover" id={id}>
          <fieldset>
            <legend>עמודות מוצגות</legend>
            {board.columns.map((c) => (
              <label key={c.id}>
                <input type="checkbox" checked={!hidden.includes(c.id)} onChange={(e) => onChange(e.target.checked ? hidden.filter((h) => h !== c.id) : [...hidden, c.id])} />
                {c.title}
              </label>
            ))}
          </fieldset>
          {hidden.length > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => onChange([])}>
              הצגת הכל
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ============================================================ saved views
export function ViewsMenu({
  board,
  config,
  activeId,
  onApply,
}: {
  board: BoardDetail;
  config: ViewConfig;
  activeId: string | null;
  onApply: (view: SavedView | null) => void;
}) {
  const views = useViews(board.id);
  const { create, update, remove } = useViewMutations(board.id);
  const { toast, confirm } = useFeedback();
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const active = views.data?.find((v) => v.id === activeId) ?? null;
  const onErr = (e: unknown) => toast(errorMessage(e), 'error');

  const save = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    create.mutate(
      { name: name.trim(), config, shared },
      { onSuccess: (v) => (setSaving(false), setName(''), setShared(false), onApply(v), toast(`התצוגה "${v.name}" נשמרה`)), onError: onErr },
    );
  };

  return (
    <>
      <label htmlFor="saved-view" className="sr-only">
        תצוגה שמורה
      </label>
      <select
        id="saved-view"
        className="select"
        value={activeId ?? ''}
        onChange={(e) => onApply(views.data?.find((v) => v.id === e.target.value) ?? null)}
      >
        <option value="">תצוגה ברירת מחדל</option>
        {views.data?.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
            {v.shared ? ' (משותפת)' : ''}
          </option>
        ))}
      </select>
      {active?.mine && (
        <button type="button" className="btn btn-sm" onClick={() => update.mutate({ id: active.id, patch: { config } }, { onSuccess: () => toast('התצוגה עודכנה'), onError: onErr })}>
          עדכון התצוגה
        </button>
      )}
      <button type="button" className="btn btn-sm" onClick={() => setSaving(true)}>
        שמירה כתצוגה
      </button>
      {active && (active.mine || (active.shared && board.myRole === 'owner')) && (
        <button
          type="button"
          className="icon-btn"
          aria-label={`מחיקת התצוגה ${active.name}`}
          onClick={async () => {
            if (await confirm({ title: 'מחיקת תצוגה', message: `למחוק את התצוגה "${active.name}"?`, confirmLabel: 'מחיקה', danger: true })) {
              remove.mutate(active.id, { onSuccess: () => (onApply(null), toast('התצוגה נמחקה')), onError: onErr });
            }
          }}
        >
          <Icon name="trash" size={16} />
        </button>
      )}
      <Dialog
        open={saving}
        onClose={() => setSaving(false)}
        title="שמירת תצוגה"
        initialFocusRef={nameRef}
        footer={
          <>
            <button type="button" className="btn" onClick={() => setSaving(false)}>
              ביטול
            </button>
            <button type="submit" form="save-view" className="btn btn-primary" disabled={!name.trim() || create.isPending}>
              שמירה
            </button>
          </>
        }
      >
        <form id="save-view" onSubmit={save}>
          <p className="muted">נשמרים: סוג התצוגה, החיפוש, הסינון, המיון והעמודות המוסתרות.</p>
          <div className="field">
            <label htmlFor="view-name">שם התצוגה</label>
            <input id="view-name" ref={nameRef} className="input" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          {board.myRole === 'owner' && (
            <label className="checkbox-row">
              <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} />
              לשתף עם כל חברי הלוח
            </label>
          )}
        </form>
      </Dialog>
    </>
  );
}

// ============================================================ trash
export function TrashDialog({ board, open, onClose }: { board: BoardDetail; open: boolean; onClose: () => void }) {
  const q = useTrash(board.id, open);
  const { restore } = useItemActions(board.id);
  const { toast } = useFeedback();
  return (
    <Dialog open={open} onClose={onClose} title="סל המחזור">
      <p className="muted">פריטים שנמחקו נשמרים 30 יום ואז נמחקים לצמיתות. תת-פריטים משוחזרים יחד עם הפריט שלהם.</p>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data?.length === 0 && <p>סל המחזור ריק.</p>}
      <ul className="list-plain item-list">
        {q.data?.map((t) => (
          <li key={t.id}>
            <span className="grow">
              {t.name}
              {t.parentId && <span className="badge">תת-פריט</span>}
              <br />
              <small className="muted">
                נמחק {formatDateTime(t.deletedAt)} · יימחק לצמיתות {formatDateTime(t.purgeAt)}
              </small>
            </span>
            <button
              type="button"
              className="btn btn-sm"
              disabled={restore.isPending}
              onClick={() => restore.mutate(t.id, { onSuccess: () => toast(`"${t.name}" שוחזר`), onError: (e) => toast(errorMessage(e), 'error') })}
            >
              שחזור
            </button>
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

// ============================================================ import
const NAME = '__name';
const SKIP = '';

export function ImportDialog({ board, members, open, onClose }: { board: BoardDetail; members: DirectoryUser[]; open: boolean; onClose: () => void }) {
  const { importRows } = useItemActions(board.id);
  const { toast } = useFeedback();
  const [rows, setRows] = useState<unknown[][] | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [groupId, setGroupId] = useState(board.groups[0]?.id ?? '');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const columns = board.columns.filter((c) => !isReadonlyColumnType(c.type) && canEditColumn(c, board.myRole));

  const reset = () => (setRows(null), setMapping([]), setError(null), setResult(null));
  const close = () => (reset(), onClose());

  const onFile = async (file: File | undefined) => {
    reset();
    if (!file) return;
    try {
      const data = (await readSpreadsheet(file)).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
      if (data.length < 2) throw new Error('הקובץ ריק או שאין בו שורות מעבר לכותרות');
      if (data.length - 1 > 1000) throw new Error('עד 1,000 שורות בייבוא אחד');
      const header = data[0]!.map((h) => String(h ?? '').trim());
      setMapping(
        header.map((h) => {
          if (/^(פריט|שם|שם הפריט|name|item)$/i.test(h)) return NAME;
          return columns.find((c) => c.title === h)?.id ?? SKIP;
        }),
      );
      setRows(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'לא ניתן לקרוא את הקובץ');
    }
  };

  const header = rows?.[0]?.map((h) => String(h ?? '')) ?? [];
  const nameIdx = mapping.indexOf(NAME);
  const body = rows?.slice(1) ?? [];
  const build = () =>
    body
      .map((r) => {
        const values: Record<string, unknown> = {};
        mapping.forEach((m, i) => {
          const col = columns.find((c) => c.id === m);
          if (!col) return;
          const v = convertCell(col, r[i], members);
          if (v !== undefined) values[col.id] = v;
        });
        return { name: String(r[nameIdx] ?? '').trim().slice(0, 300), values };
      })
      .filter((r) => r.name);

  const submit = () => {
    const payload = build();
    if (!payload.length) return setError('אין שורות עם שם פריט');
    importRows.mutate(
      { groupId, rows: payload },
      { onSuccess: (r) => (setResult(r), toast(`יובאו ${r.created} פריטים`)), onError: (e) => setError(errorMessage(e)) },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="ייבוא מ-Excel / CSV"
      footer={
        result ? (
          <button type="button" className="btn btn-primary" onClick={close}>
            סיום
          </button>
        ) : (
          <>
            <button type="button" className="btn" onClick={close}>
              ביטול
            </button>
            <button type="button" className="btn btn-primary" disabled={!rows || nameIdx < 0 || importRows.isPending} onClick={submit}>
              {importRows.isPending ? 'מייבא…' : `ייבוא ${body.length} שורות`}
            </button>
          </>
        )
      }
    >
      {result ? (
        <div role="status">
          <p>
            <strong>יובאו {result.created} פריטים.</strong>
          </p>
          {result.errors.length > 0 && (
            <>
              <p>{result.errors.length} שורות לא יובאו:</p>
              <ul>
                {result.errors.map((e) => (
                  <li key={e.row}>
                    שורה {e.row + 1}: {e.message}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="field">
            <label htmlFor="import-file">קובץ</label>
            <input id="import-file" type="file" className="input" accept=".csv,.xlsx" aria-describedby="import-hint" onChange={(e) => void onFile(e.target.files?.[0])} />
            <span id="import-hint" className="hint">
              השורה הראשונה = כותרות. עד 1,000 שורות, עד 5MB. הקובץ נקרא בדפדפן בלבד; לשרת נשלחים רק הערכים, והם נבדקים כמו עריכה ידנית.
            </span>
          </div>
          {error && (
            <div className="form-error" role="alert">
              {error}
            </div>
          )}
          {rows && (
            <>
              <div className="field">
                <label htmlFor="import-group">לקבוצה</label>
                <select id="import-group" className="select" value={groupId} onChange={(e) => setGroupId(e.target.value)}>
                  {board.groups.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
              <table className="data-table">
                <caption className="label" style={{ textAlign: 'start' }}>
                  התאמת עמודות ({body.length} שורות)
                </caption>
                <thead>
                  <tr>
                    <th scope="col">עמודה בקובץ</th>
                    <th scope="col">דוגמה</th>
                    <th scope="col">עמודה בלוח</th>
                  </tr>
                </thead>
                <tbody>
                  {header.map((h, i) => (
                    <tr key={i}>
                      <th scope="row">{h || `עמודה ${i + 1}`}</th>
                      <td className="muted">{String(body[0]?.[i] ?? '').slice(0, 40)}</td>
                      <td>
                        <select
                          className="select"
                          aria-label={`מיפוי העמודה ${h || i + 1}`}
                          value={mapping[i] ?? SKIP}
                          onChange={(e) => setMapping((m) => m.map((x, j) => (j === i ? e.target.value : x === e.target.value && e.target.value !== SKIP ? SKIP : x)))}
                        >
                          <option value={SKIP}>— לא לייבא —</option>
                          <option value={NAME}>שם הפריט</option>
                          {columns.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.title}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {nameIdx < 0 && (
                <p className="error" role="alert">
                  יש לבחור איזו עמודה בקובץ היא "שם הפריט".
                </p>
              )}
            </>
          )}
        </>
      )}
    </Dialog>
  );
}
