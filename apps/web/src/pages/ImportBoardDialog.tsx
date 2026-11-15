import { analyzeSheet, COLOR_KEYS, importCellText, LIMITS, type BoardDetail, type Column, type ImportColumnType, type ImportResult, type SheetAnalysis } from '@suboard/shared';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { useWorkspaces } from '../api/hooks';
import { Dialog } from '../components/Dialog';
import { useFeedback } from '../components/Feedback';
import { convertCell, readSpreadsheet } from './board/importParse';

const TYPE_LABELS: Record<ImportColumnType | 'skip', string> = { text: 'טקסט', long_text: 'טקסט ארוך', number: 'מספר', date: 'תאריך', checkbox: 'תיבת סימון', status: 'סטטוס (תוויות)', skip: 'לא לייבא' };
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
  const [types, setTypes] = useState<(ImportColumnType | 'skip')[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);

  const reset = () => (setSheet(null), setName(''), setTypes([]), setError(null), setProgress(null));
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

  const build = async () => {
    if (!sheet) return;
    if (!name.trim()) return setError('יש לתת שם ללוח');
    const chosen = sheet.columns.map((c, i) => ({ c, type: types[i] ?? c.type })).filter((x) => x.type !== 'skip') as { c: SheetAnalysis['columns'][number]; type: ImportColumnType }[];
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
                    <select className="select" value={types[i] ?? c.type} aria-label={`סוג העמודה ${c.title}`} onChange={(e) => setTypes((t) => t.map((x, j) => (j === i ? (e.target.value as ImportColumnType | 'skip') : x)))}>
                      {(Object.keys(TYPE_LABELS) as (ImportColumnType | 'skip')[]).map((t) => (
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
          <p className="hint">שמות של אנשים מיובאים כטקסט או כתוויות — שיוך לאנשים במערכת נעשה אחרי הייבוא. תת-פריטים, קבצים ועדכונים אינם חלק מקובץ כזה.</p>
        </>
      )}
    </Dialog>
  );
}
