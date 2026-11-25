import { analyzeSheet, COLOR_KEYS, importCellText, LIMITS, type BoardDetail, type Column, type ImportColumnType, type ImportResult, type SheetAnalysis } from '@suboard/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useDirectory, useWorkspaces } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { Dialog } from '../components/Dialog';
import { useFeedback } from '../components/Feedback';
import { convertCell, readSpreadsheet } from './board/importParse';

type ChosenType = ImportColumnType | 'person' | 'skip';
const TYPE_LABELS: Record<ChosenType, string> = { text: 'טקסט', long_text: 'טקסט ארוך', number: 'מספר', date: 'תאריך', checkbox: 'תיבת סימון', status: 'סטטוס (תוויות)', person: 'אנשים (שיוך למשתמשים)', skip: 'לא לייבא' };
const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('he');
const namesIn = (v: unknown) => importCellText(v).split(/[;,\n]/).map((x) => x.trim()).filter(Boolean);
const IMPORT_LIMITS = { maxColumns: LIMITS.columnsPerBoard, maxGroups: 30, maxItems: 5000, maxOptions: LIMITS.statusOptions, titleLength: LIMITS.columnTitle, groupLength: LIMITS.groupName };
const CHUNK = 500;

/**
 * A new board from a spreadsheet (CSV / XLSX): the file is read in the browser, its outline is shown
 * for review (title, groups, columns and their types), and the board is then built through the
 * ordinary API — so every value passes the same server-side validation as manual entry.
 */
export function ImportBoardDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useFeedback();
  const workspaces = useWorkspaces();
  const [sheet, setSheet] = useState<SheetAnalysis | null>(null);
  const [name, setName] = useState('');
  const [types, setTypes] = useState<ChosenType[]>([]);
  const directory = useDirectory();
  const { user } = useAuth();
  /** Adding people to the new board grants them access to it: off until the person ticks it. */
  const [addMembers, setAddMembers] = useState(false);
  const [workspaceId, setWorkspaceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const reset = () => (setSheet(null), setName(''), setTypes([]), setError(null), setProgress(null), setAddMembers(false));
  const close = () => {
    if (progress) return; // never close in the middle of building the board
    reset();
    onClose();
  };

  const onFile = async (file: File | undefined) => {
    reset();
    if (!file) return;
    try {
      const a = analyzeSheet(await readSpreadsheet(file), IMPORT_LIMITS);
      if ('error' in a) return setError(a.error);
      setSheet(a);
      setName((a.title ?? file.name.replace(/\.(csv|xlsx)$/i, '')).slice(0, LIMITS.boardName));
      setTypes(a.columns.map((c) => c.type));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'לא ניתן לקרוא את הקובץ');
    }
  };

  /** Distinct labels of a column that was switched to "status" by hand. */
  const labelsOf = (a: SheetAnalysis, index: number): string[] => [...new Set(a.groups.flatMap((g) => g.rows.map((r) => importCellText(r[index]).slice(0, LIMITS.statusLabel))).filter(Boolean))];

  // People columns: a name in the file is matched only to exactly one active, non-guest user of
  // the same full name. No partial or fuzzy matching — assigning the wrong person is worse than an empty cell.
  const byName = new Map<string, string | null>();
  for (const u of directory.data ?? []) {
    if (u.guest) continue;
    const k = norm(u.name);
    byName.set(k, byName.has(k) ? null : u.id); // two users with the same name: ambiguous, never matched
  }
  const personIndexes = sheet ? sheet.columns.filter((_, i) => types[i] === 'person').map((c) => c.index) : [];
  const fileNames = sheet ? [...new Set(sheet.groups.flatMap((g) => g.rows.flatMap((r) => personIndexes.flatMap((ix) => namesIn(r[ix])))))] : [];
  const matched = fileNames.filter((n) => byName.get(norm(n)));
  const unmatched = fileNames.filter((n) => !byName.get(norm(n)));
  const idsToAdd = [...new Set(matched.map((n) => byName.get(norm(n))!))].filter((id) => id !== user?.id);

  const build = async () => {
    if (!sheet) return;
    if (personIndexes.length && !addMembers) return setError('כדי לשייך אנשים צריך לאשר את הוספתם כחברי הלוח (התיבה שמתחת לטבלה), או לשנות את סוג העמודה ל"טקסט".');
    if (!name.trim()) return setError('יש לתת שם ללוח');
    const chosen = sheet.columns.map((c, i) => ({ c, type: types[i] ?? c.type })).filter((x) => x.type !== 'skip') as { c: SheetAnalysis['columns'][number]; type: ImportColumnType | 'person' }[];
    for (const x of chosen) {
      if (x.type === 'status' && labelsOf(sheet, x.c.index).length > LIMITS.statusOptions) return setError(`בעמודה "${x.c.title}" יש יותר מ-${LIMITS.statusOptions} ערכים שונים — היא אינה מתאימה לסטטוס. בחרו "טקסט".`);
    }
    setError(null);
    let boardId: string | null = null;
    try {
      setProgress('יוצר את הלוח…');
      const board = (await api<{ board: BoardDetail }>('/boards', 'POST', { name: name.trim(), templateKey: 'blank', ...(workspaceId ? { workspaceId } : {}) })).board;
      boardId = board.id;
      // The blank template's own columns are replaced by the file's columns.
      for (const c of board.columns) await api(`/columns/${c.id}`, 'DELETE');
      // The people who were recognised become editors of the new board (the person agreed above).
      if (personIndexes.length) {
        setProgress('מוסיף את האנשים שזוהו כחברי הלוח…');
        for (const userId of idsToAdd) await api(`/boards/${board.id}/members`, 'PUT', { userId, role: 'editor' });
      }
      const created: { column: Column; index: number }[] = [];
      for (const x of chosen) {
        const settings = x.type === 'status' ? { options: labelsOf(sheet, x.c.index).map((label, i) => ({ id: `o${i + 1}`, label, color: COLOR_KEYS[i % COLOR_KEYS.length]! })) } : undefined;
        const column = (await api<{ column: Column }>(`/boards/${board.id}/columns`, 'POST', { title: x.c.title, type: x.type, ...(settings ? { settings } : {}) })).column;
        created.push({ column, index: x.c.index });
      }
      let done = 0;
      let failed = 0;
      for (const [gi, g] of sheet.groups.entries()) {
        const groupId =
          gi === 0 && board.groups[0]
            ? (await api<{ group: { id: string } }>(`/groups/${board.groups[0].id}`, 'PATCH', { name: g.name })).group.id
            : (await api<{ group: { id: string } }>(`/boards/${board.id}/groups`, 'POST', { name: g.name })).group.id;
        for (let at = 0; at < g.rows.length; at += CHUNK) {
          setProgress(`מייבא פריטים: ${done} מתוך ${sheet.itemCount}…`);
          const rows = g.rows.slice(at, at + CHUNK).map((r) => {
            const values: Record<string, unknown> = {};
            for (const { column, index } of created) {
              if (column.type === 'person') {
                const ids = [...new Set(namesIn(r[index]).map((n) => byName.get(norm(n))).filter((id): id is string => Boolean(id)))].slice(0, LIMITS.personsPerCell);
                if (ids.length) values[column.id] = ids;
                continue;
              }
              let v = convertCell(column, column.type === 'status' ? importCellText(r[index]).slice(0, LIMITS.statusLabel) : r[index], []);
              if (typeof v === 'string' && column.type === 'text') v = v.slice(0, LIMITS.text);
              if (typeof v === 'string' && column.type === 'long_text') v = v.slice(0, LIMITS.longText);
              if (v !== undefined) values[column.id] = v;
            }
            return { name: importCellText(r[sheet.nameIndex]).slice(0, LIMITS.itemName), values };
          });
          const res = await api<ImportResult>(`/boards/${board.id}/import`, 'POST', { groupId, rows });
          done += res.created;
          failed += res.errors.length;
        }
      }
      void qc.invalidateQueries({ queryKey: ['boards'] });
      toast(failed ? `הלוח נוצר: ${done} פריטים יובאו, ${failed} שורות נדחו (ערך לא תקין).` : `הלוח נוצר: ${done} פריטים יובאו.`, failed ? 'error' : undefined);
      setProgress(null);
      reset();
      onClose();
      navigate(`/boards/${board.id}`);
    } catch (e) {
      setProgress(null);
      void qc.invalidateQueries({ queryKey: ['boards'] });
      setError(boardId ? `הייבוא נעצר באמצע: ${errorMessage(e)} הלוח נוצר חלקית — אפשר לפתוח אותו מרשימת הלוחות, או למחוק אותו ולנסות שוב.` : errorMessage(e));
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="לוח חדש מקובץ"
      footer={
        <>
          <button type="button" className="btn" onClick={close} disabled={Boolean(progress)}>
            ביטול
          </button>
          <button type="button" className="btn btn-primary" onClick={() => void build()} disabled={!sheet || Boolean(progress)}>
            {progress ? 'מייבא…' : 'יצירת הלוח'}
          </button>
        </>
      }
    >
      <p className="muted">
        קובץ CSV או XLSX (עד 5MB), למשל ייצוא של לוח ממערכת אחרת. הקובץ נקרא בדפדפן בלבד ואינו נשמר בשרת; רק הנתונים שתאשרו כאן נשלחים. שם הפריט נלקח מעמודה בשם "שם" / "פריט" / "Name", ואם אין כזו — מהעמודה הראשונה.
      </p>
      <div className="field">
        <label htmlFor="ib-file">קובץ</label>
        <input id="ib-file" type="file" className="input" accept=".csv,.xlsx" disabled={Boolean(progress)} onChange={(e) => void onFile(e.target.files?.[0])} />
      </div>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      {progress && (
        <p role="status" aria-live="polite">
          {progress}
        </p>
      )}
      {sheet && (
        <>
          <div className="field">
            <label htmlFor="ib-name">שם הלוח</label>
            <input id="ib-name" className="input" value={name} maxLength={LIMITS.boardName} onChange={(e) => setName(e.target.value)} />
          </div>
          {(workspaces.data ?? []).length > 0 && (
            <div className="field">
              <label htmlFor="ib-ws">סביבת עבודה</label>
              <select id="ib-ws" className="select" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)}>
                <option value="">ללא</option>
                {workspaces.data!.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>
          )}
          <p>
            נמצאו <strong className="num">{sheet.itemCount}</strong> פריטים ב-<strong className="num">{sheet.groups.length}</strong> קבוצות: {sheet.groups.map((g) => `${g.name} (${g.rows.length})`).join(' · ')}
          </p>
          {sheet.warnings.length > 0 && (
            <ul className="hint" aria-label="הערות על הקובץ">
              {sheet.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          )}
          <table className="data-table">
            <caption>עמודות שיווצרו בלוח — אפשר לשנות את הסוג או לדלג על עמודה</caption>
            <thead>
              <tr>
                <th scope="col">עמודה בקובץ</th>
                <th scope="col">סוג בלוח</th>
                <th scope="col">דוגמה</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">{sheet.nameHeader || 'עמודה ראשונה'}</th>
                <td>שם הפריט</td>
                <td className="muted">{importCellText(sheet.groups[0]?.rows[0]?.[sheet.nameIndex]).slice(0, 40)}</td>
              </tr>
              {sheet.columns.map((c, i) => (
                <tr key={c.index}>
                  <th scope="row">{c.title}</th>
                  <td>
                    <select className="select" value={types[i] ?? c.type} aria-label={`סוג העמודה ${c.title}`} onChange={(e) => setTypes((t) => t.map((x, j) => (j === i ? (e.target.value as ChosenType) : x)))}>
                      {(Object.keys(TYPE_LABELS) as ChosenType[]).map((t) => (
                        <option key={t} value={t}>
                          {TYPE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="muted">
                    {importCellText(
                      sheet.groups
                        .flatMap((g) => g.rows)
                        .map((r) => r[c.index])
                        .find((v) => importCellText(v)),
                    ).slice(0, 40)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {personIndexes.length > 0 && (
            <fieldset className="formula-editor">
              <legend>שיוך אנשים</legend>
              <p>
                זוהו <strong className="num">{matched.length}</strong> מתוך <strong className="num">{fileNames.length}</strong> שמות, בהתאמה מלאה לשם של משתמש פעיל במערכת.
              </p>
              {matched.length > 0 && <p className="hint">זוהו: {matched.join(', ')}</p>}
              {unmatched.length > 0 && (
                <p className="hint">
                  לא זוהו ולא ישויכו (התא יישאר ריק): {unmatched.slice(0, 30).join(', ')}
                  {unmatched.length > 30 ? '…' : ''}
                </p>
              )}
              <label className="check">
                <input type="checkbox" checked={addMembers} onChange={(e) => setAddMembers(e.target.checked)} aria-describedby="ib-members-hint" /> להוסיף את {idsToAdd.length} האנשים שזוהו כחברי הלוח החדש (עורכים)
              </label>
              <span id="ib-members-hint" className="hint">
                אפשר לשייך לפריט רק חבר לוח, ולכן שיוך מחייב להוסיף אותם ללוח — וזה נותן להם גישה לכל תוכנו. בלי הסימון, שנו את סוג העמודה ל"טקסט".
              </span>
            </fieldset>
          )}
          <p className="hint">שיוך אנשים: בחרו לעמודה את הסוג "אנשים" (ברירת המחדל היא טקסט או תוויות). תת-פריטים, קבצים ועדכונים אינם חלק מקובץ כזה.</p>
        </>
      )}
    </Dialog>
  );
}
