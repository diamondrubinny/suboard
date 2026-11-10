import { CAUSE_CATEGORIES, CAUSE_LABELS, formatDateHe, LIMITS, type BoardDetail, type CauseCategory, type Investigation } from '@suboard/shared';
import { useEffect, useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { useBoard, useBoards, useInvestigation, useInvestigationMutations } from '../../api/hooks';
import { LinksSection } from './LinksSection';
import { Dialog } from '../../components/Dialog';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { QrCode, qrUrl } from '../../components/QrCode';

// ---------------------------------------------------------------- QR
export function QrDialog({ board, itemId, open, onClose }: { board: BoardDetail; itemId: string; open: boolean; onClose: () => void }) {
  const item = board.items.find((i) => i.id === itemId);
  if (!item) return null;
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={`קוד QR: ${item.name}`}
      footer={
        <>
          <Link className="btn" to={`/boards/${board.id}/qr?items=${item.id}`}>
            <Icon name="download" /> הדפסת מדבקה
          </Link>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            סגירה
          </button>
        </>
      }
    >
      <div className="qr-dialog">
        <QrCode value={qrUrl(item.id)} size={220} label={`קוד QR לפריט ${item.name}`} />
        <p className="hint">
          סריקה בטלפון פותחת את כרטיס הפריט (אחרי התחברות): נתונים, עדכונים אחרונים, דיווח תקלה וצילום. רק מי שיש לו גישה ללוח יראה את הפריט.
        </p>
        <code className="qr-url">{qrUrl(item.id)}</code>
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------- investigation
type Draft = Omit<Investigation, 'itemId' | 'updatedAt' | 'updatedByName'>;

export function InvestigationPanel({ board, itemId }: { board: BoardDetail; itemId: string }) {
  const q = useInvestigation(itemId);
  const { save } = useInvestigationMutations(itemId, board.id);
  const { toast } = useFeedback();
  const canEdit = board.myRole !== 'viewer';
  const [draft, setDraft] = useState<Draft | null>(null);
  const [actionOpen, setActionOpen] = useState(false);
  const ids = { root: useId(), due: useId(), result: useId(), note: useId() };
  // Re-seed the form when data first arrives and after each save (a new investigation has updatedAt null).
  const loadedKey = q.data ? (q.data.updatedAt ?? 'new') : 'pending';
  useEffect(() => {
    if (q.data) {
      const { itemId: _i, updatedAt: _u, updatedByName: _n, ...rest } = q.data;
      setDraft({ ...rest, whys: [...rest.whys, ...Array(Math.max(0, 5 - rest.whys.length)).fill('')].slice(0, 5) });
    }
  }, [loadedKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (q.isPending || !draft) return <LoadingState />;
  if (q.isError) return <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />;

  const onSave = () =>
    save.mutate(
      { ...draft, whys: draft.whys.map((w) => w.trim()).filter(Boolean) },
      { onSuccess: () => toast('התחקיר נשמר'), onError: (e) => toast(errorMessage(e), 'error') },
    );
  const toggleCat = (c: CauseCategory) => setDraft({ ...draft, categories: draft.categories.includes(c) ? draft.categories.filter((x) => x !== c) : [...draft.categories, c] });

  return (
    <div className="investigation">
      <p className="hint">אין להזין מידע רפואי או פרטים מזהים של נפגעים. תוכן התחקיר לא נשמר בהיסטוריית השינויים.</p>
      <fieldset className="rule-block" disabled={!canEdit}>
        <legend>
          <span className="rule-kw">5 למה</span> <span className="muted">— כל תשובה מובילה לשאלה הבאה</span>
        </legend>
        {draft.whys.map((w, i) => (
          <div className="field" key={i}>
            <label htmlFor={`${ids.root}-why-${i}`}>למה {i + 1}?</label>
            <textarea
              id={`${ids.root}-why-${i}`}
              className="textarea"
              rows={2}
              maxLength={LIMITS.why}
              value={w}
              onChange={(e) => setDraft({ ...draft, whys: draft.whys.map((x, j) => (j === i ? e.target.value : x)) })}
            />
          </div>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={ids.root}>גורם שורש</label>
        <textarea id={ids.root} className="textarea" rows={3} maxLength={LIMITS.rootCause} disabled={!canEdit} value={draft.rootCause} onChange={(e) => setDraft({ ...draft, rootCause: e.target.value })} />
      </div>
      <fieldset className="check-list" disabled={!canEdit}>
        <legend className="label">קטגוריות גורם</legend>
        {CAUSE_CATEGORIES.map((c) => (
          <label key={c} className="check">
            <input type="checkbox" checked={draft.categories.includes(c)} onChange={() => toggleCat(c)} /> {CAUSE_LABELS[c]}
          </label>
        ))}
      </fieldset>

      <section className="rule-block" aria-labelledby={`${ids.root}-actions`}>
        <div className="section-head">
          <h3 id={`${ids.root}-actions`} style={{ margin: 0 }}>
            פעולות מתקנות
          </h3>
          {canEdit && (
            <button type="button" className="btn btn-sm" onClick={() => setActionOpen(true)}>
              <Icon name="plus" /> פעולה מתקנת חדשה
            </button>
          )}
        </div>
        <LinksSection itemId={itemId} />
      </section>

      <fieldset className="rule-block" disabled={!canEdit}>
        <legend>
          <span className="rule-kw">בדיקת אפקטיביות</span>
        </legend>
        <div className="rule-row">
          <div className="field">
            <label htmlFor={ids.due}>מועד בדיקה</label>
            <input id={ids.due} type="date" className="input" value={draft.effectivenessDue ?? ''} onChange={(e) => setDraft({ ...draft, effectivenessDue: e.target.value || null })} />
          </div>
          <div className="field">
            <label htmlFor={ids.result}>תוצאה</label>
            <select id={ids.result} className="select" value={draft.effectivenessResult ?? ''} onChange={(e) => setDraft({ ...draft, effectivenessResult: (e.target.value || null) as Draft['effectivenessResult'] })}>
              <option value="">טרם נבדק</option>
              <option value="effective">הפעולות אפקטיביות</option>
              <option value="not_effective">לא אפקטיביות — נדרשות פעולות נוספות</option>
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor={ids.note}>הערה</label>
          <input id={ids.note} className="input" maxLength={LIMITS.why} value={draft.effectivenessNote} onChange={(e) => setDraft({ ...draft, effectivenessNote: e.target.value })} />
        </div>
        {draft.effectivenessDue && !draft.effectivenessResult && <p className="hint">ב-{formatDateHe(draft.effectivenessDue)} תישלח תזכורת לאחראים ולבעלי הלוח.</p>}
      </fieldset>

      {q.data?.updatedAt && (
        <p className="muted" style={{ fontSize: '0.85rem' }}>
          עודכן לאחרונה ע"י {q.data.updatedByName ?? 'משתמש'}
        </p>
      )}
      {canEdit && (
        <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={onSave}>
          {save.isPending ? 'שומר…' : 'שמירת התחקיר'}
        </button>
      )}
      {actionOpen && <LinkedActionDialog board={board} itemId={itemId} onClose={() => setActionOpen(false)} />}
    </div>
  );
}

/** Opens a corrective action on a board where the user can edit, linked to this item. */
function LinkedActionDialog({ board, itemId, onClose }: { board: BoardDetail; itemId: string; onClose: () => void }) {
  const boards = useBoards();
  const editable = (boards.data ?? []).filter((b) => b.myRole !== 'viewer');
  const preferred = editable.find((b) => b.templateKey === 'capa') ?? editable.find((b) => b.id !== board.id) ?? editable[0];
  const [targetId, setTargetId] = useState('');
  const target = targetId || preferred?.id || '';
  const targetBoard = useBoard(target);
  const [groupId, setGroupId] = useState('');
  const item = board.items.find((i) => i.id === itemId);
  const [name, setName] = useState(item ? `פעולה מתקנת: ${item.name}`.slice(0, LIMITS.itemName) : '');
  const [error, setError] = useState<string | null>(null);
  const { action } = useInvestigationMutations(itemId, board.id);
  const { toast } = useFeedback();
  const ids = { b: useId(), g: useId(), n: useId() };
  const group = groupId || targetBoard.data?.groups[0]?.id || '';

  return (
    <Dialog
      open
      onClose={onClose}
      title="פעולה מתקנת חדשה"
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            ביטול
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!target || !group || !name.trim() || action.isPending}
            onClick={() =>
              action.mutate(
                { boardId: target, groupId: group, name: name.trim() },
                { onSuccess: () => (toast('הפעולה המתקנת נפתחה וקושרה לתחקיר'), onClose()), onError: (e) => setError(errorMessage(e)) },
              )
            }
          >
            פתיחה וקישור
          </button>
        </>
      }
    >
      <div className="rule-editor">
        <div className="field">
          <label htmlFor={ids.b}>בלוח</label>
          <select id={ids.b} className="select" value={target} onChange={(e) => (setTargetId(e.target.value), setGroupId(''))}>
            {editable.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          <span className="hint">רק לוחות שבהם יש לך הרשאת עריכה.</span>
        </div>
        <div className="field">
          <label htmlFor={ids.g}>קבוצה</label>
          <select id={ids.g} className="select" value={group} onChange={(e) => setGroupId(e.target.value)}>
            {(targetBoard.data?.groups ?? []).map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.n}>שם הפעולה</label>
          <input id={ids.n} className="input" maxLength={LIMITS.itemName} value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}
