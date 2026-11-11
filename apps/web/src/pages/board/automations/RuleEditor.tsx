import { isReadonlyColumnType,
  createAutomationSchema,
  LIMITS,
  type Automation,
  type BoardDetail,
  type Column,
  type RuleAction,
  type RuleCondition,
  type RuleTrigger,
} from '@suboard/shared';
import { useId, useState } from 'react';
import { errorMessage } from '../../../api/client';
import { useAutomationMutations } from '../../../api/hooks';
import { Dialog } from '../../../components/Dialog';
import { useFeedback } from '../../../components/Feedback';
import { Icon } from '../../../components/Icon';
import {
  ACTION_LABELS,
  actionText,
  CONDITION_LABELS,
  conditionText,
  defaultAction,
  defaultCondition,
  defaultTrigger,
  isAvailable,
  RECIPES,
  TRIGGER_LABELS,
  triggerText,
} from './ruleModel';

interface Draft {
  name: string;
  trigger: RuleTrigger;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

// ---------------------------------------------------------------- small field helpers
function ColumnSelect({ board, types, value, onChange, label }: { board: BoardDetail; types: Column['type'][] | 'any'; value: string; onChange: (id: string) => void; label: string }) {
  const id = useId();
  const cols = board.columns.filter((c) => (types === 'any' ? !isReadonlyColumnType(c.type) : types.includes(c.type)));
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {!cols.some((c) => c.id === value) && <option value="">— בחירה —</option>}
        {cols.map((c) => (
          <option key={c.id} value={c.id}>
            {c.title}
          </option>
        ))}
      </select>
    </div>
  );
}

function OptionSelect({ column, value, onChange, label, allowAny }: { column: Column | undefined; value: string; onChange: (v: string) => void; label: string; allowAny?: boolean }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {allowAny && <option value="">כל תווית</option>}
        {(column?.settings.options ?? []).map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberField({ label, value, onChange, min, max, hint }: { label: string; value: number; onChange: (n: number) => void; min: number; max: number; hint?: string }) {
  const id = useId();
  const hintId = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        className="input"
        min={min}
        max={max}
        value={Number.isFinite(value) ? value : ''}
        aria-describedby={hint ? hintId : undefined}
        onChange={(e) => onChange(Math.max(min, Math.min(max, Math.trunc(Number(e.target.value) || 0))))}
      />
      {hint && (
        <span id={hintId} className="hint">
          {hint}
        </span>
      )}
    </div>
  );
}

function MemberChecks({ board, value, onChange, legend }: { board: BoardDetail; value: string[]; onChange: (ids: string[]) => void; legend: string }) {
  return (
    <fieldset className="check-list">
      <legend className="label">{legend}</legend>
      {board.members.map((m) => (
        <label key={m.userId} className="check">
          <input
            type="checkbox"
            checked={value.includes(m.userId)}
            onChange={(e) => onChange(e.target.checked ? [...value, m.userId].slice(0, LIMITS.personsPerCell) : value.filter((x) => x !== m.userId))}
          />{' '}
          {m.name}
        </label>
      ))}
    </fieldset>
  );
}

const col = (b: BoardDetail, id: string) => b.columns.find((c) => c.id === id);

// ---------------------------------------------------------------- trigger
function TriggerFields({ board, value, onChange }: { board: BoardDetail; value: RuleTrigger; onChange: (t: RuleTrigger) => void }) {
  const id = useId();
  return (
    <>
      <div className="field">
        <label htmlFor={id}>טריגר</label>
        <select id={id} className="select" value={value.type} onChange={(e) => onChange(defaultTrigger(board, e.target.value as RuleTrigger['type']))}>
          {(Object.keys(TRIGGER_LABELS) as RuleTrigger['type'][]).map((t) => (
            <option key={t} value={t} disabled={!isAvailable(board, t)}>
              {TRIGGER_LABELS[t]}
              {!isAvailable(board, t) ? ' (אין עמודה מתאימה)' : ''}
            </option>
          ))}
        </select>
      </div>
      {value.type === 'status_changed' && (
        <div className="rule-row">
          <ColumnSelect board={board} types={['status']} label="עמודה" value={value.columnId} onChange={(columnId) => onChange({ ...value, columnId, to: undefined })} />
          <OptionSelect column={col(board, value.columnId)} label="לתווית" allowAny value={value.to ?? ''} onChange={(to) => onChange({ ...value, to: to || undefined })} />
        </div>
      )}
      {(value.type === 'checkbox_checked' || value.type === 'person_assigned') && (
        <ColumnSelect board={board} types={[value.type === 'checkbox_checked' ? 'checkbox' : 'person']} label="עמודה" value={value.columnId} onChange={(columnId) => onChange({ ...value, columnId })} />
      )}
      {value.type === 'date_reached' && (
        <div className="rule-row">
          <ColumnSelect board={board} types={['date']} label="עמודת תאריך" value={value.columnId} onChange={(columnId) => onChange({ ...value, columnId })} />
          <NumberField
            label="הפרש בימים"
            min={-365}
            max={365}
            value={value.offsetDays}
            onChange={(offsetDays) => onChange({ ...value, offsetDays })}
            hint="שלילי = לפני התאריך, 0 = ביום עצמו, חיובי = אחרי. נבדק פעם ביום."
          />
        </div>
      )}
      {value.type === 'status_stale' && (
        <div className="rule-row">
          <ColumnSelect board={board} types={['status']} label="עמודה" value={value.columnId} onChange={(columnId) => onChange({ ...value, columnId, optionId: col(board, columnId)?.settings.options?.[0]?.id ?? '' })} />
          <OptionSelect column={col(board, value.columnId)} label="בתווית" value={value.optionId} onChange={(optionId) => onChange({ ...value, optionId })} />
          <NumberField label="לפחות ימים" min={1} max={365} value={value.days} onChange={(days) => onChange({ ...value, days })} hint="נבדק פעם ביום; פעם אחת לכל כניסה לתווית." />
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------- conditions
function ConditionFields({ board, value, onChange }: { board: BoardDetail; value: RuleCondition; onChange: (c: RuleCondition) => void }) {
  if (value.type === 'status_is' || value.type === 'status_is_not') {
    const c = col(board, value.columnId);
    return (
      <>
        <ColumnSelect board={board} types={['status']} label="עמודה" value={value.columnId} onChange={(columnId) => onChange({ ...value, columnId, optionIds: [] })} />
        <fieldset className="check-list">
          <legend className="label">תוויות</legend>
          {(c?.settings.options ?? []).map((o) => (
            <label key={o.id} className="check">
              <input
                type="checkbox"
                checked={value.optionIds.includes(o.id)}
                onChange={(e) => onChange({ ...value, optionIds: e.target.checked ? [...value.optionIds, o.id] : value.optionIds.filter((x) => x !== o.id) })}
              />{' '}
              {o.label}
            </label>
          ))}
        </fieldset>
      </>
    );
  }
  if (value.type === 'group_is') {
    return <GroupSelect board={board} value={value.groupId} onChange={(groupId) => onChange({ ...value, groupId })} />;
  }
  if (value.type === 'person_empty') {
    return <ColumnSelect board={board} types={['person']} label="עמודה" value={value.columnId} onChange={(columnId) => onChange({ ...value, columnId })} />;
  }
  return null;
}

function GroupSelect({ board, value, onChange }: { board: BoardDetail; value: string; onChange: (id: string) => void }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>קבוצה</label>
      <select id={id} className="select" value={value} onChange={(e) => onChange(e.target.value)}>
        {board.groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------- actions
function ActionFields({ board, value, onChange }: { board: BoardDetail; value: RuleAction; onChange: (a: RuleAction) => void }) {
  const msgId = useId();
  const nameId = useId();
  const valId = useId();
  const modeId = useId();
  switch (value.type) {
    case 'set_status':
      return (
        <div className="rule-row">
          <ColumnSelect board={board} types={['status']} label="עמודה" value={value.columnId} onChange={(columnId) => onChange({ ...value, columnId, optionId: col(board, columnId)?.settings.options?.[0]?.id ?? '' })} />
          <OptionSelect column={col(board, value.columnId)} label="לתווית" value={value.optionId} onChange={(optionId) => onChange({ ...value, optionId })} />
        </div>
      );
    case 'set_checkbox':
      return (
        <div className="rule-row">
          <ColumnSelect board={board} types={['checkbox']} label="עמודה" value={value.columnId} onChange={(columnId) => onChange({ ...value, columnId })} />
          <div className="field">
            <label htmlFor={valId}>פעולה</label>
            <select id={valId} className="select" value={value.value ? '1' : '0'} onChange={(e) => onChange({ ...value, value: e.target.value === '1' })}>
              <option value="1">סימון</option>
              <option value="0">ניקוי</option>
            </select>
          </div>
        </div>
      );
    case 'assign':
      return (
        <>
          <div className="rule-row">
            <ColumnSelect board={board} types={['person']} label="עמודה" value={value.columnId} onChange={(columnId) => onChange({ ...value, columnId })} />
            <div className="field">
              <label htmlFor={modeId}>אופן</label>
              <select id={modeId} className="select" value={value.mode} onChange={(e) => onChange({ ...value, mode: e.target.value as 'replace' | 'add' })}>
                <option value="replace">החלפת האחראים</option>
                <option value="add">הוספה לאחראים הקיימים</option>
              </select>
            </div>
          </div>
          <MemberChecks board={board} legend="אנשים" value={value.userIds} onChange={(userIds) => onChange({ ...value, userIds })} />
        </>
      );
    case 'clear':
      return <ColumnSelect board={board} types="any" label="עמודה" value={value.columnId} onChange={(columnId) => onChange({ ...value, columnId })} />;
    case 'set_date':
      return (
        <div className="rule-row">
          <ColumnSelect board={board} types={['date']} label="עמודה" value={value.columnId} onChange={(columnId) => onChange({ ...value, columnId })} />
          <NumberField label="היום + ימים" min={-365} max={3650} value={value.offsetDays} onChange={(offsetDays) => onChange({ ...value, offsetDays })} />
        </div>
      );
    case 'move_group':
      return <GroupSelect board={board} value={value.groupId} onChange={(groupId) => onChange({ ...value, groupId })} />;
    case 'create_subitem':
      return (
        <div className="field">
          <label htmlFor={nameId}>שם תת-הפריט</label>
          <input id={nameId} className="input" maxLength={LIMITS.itemName} value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
        </div>
      );
    case 'notify': {
      const personCols = board.columns.filter((c) => c.type === 'person');
      return (
        <>
          <fieldset className="check-list">
            <legend className="label">למי לשלוח</legend>
            <label className="check">
              <input type="checkbox" checked={value.to.owners} onChange={(e) => onChange({ ...value, to: { ...value.to, owners: e.target.checked } })} /> בעלי הלוח
            </label>
            {personCols.map((c) => (
              <label key={c.id} className="check">
                <input
                  type="checkbox"
                  checked={value.to.columnId === c.id}
                  onChange={(e) => onChange({ ...value, to: { ...value.to, columnId: e.target.checked ? c.id : undefined } })}
                />{' '}
                האחראים בעמודה "{c.title}"
              </label>
            ))}
          </fieldset>
          <MemberChecks board={board} legend="משתמשים נוספים" value={value.to.userIds} onChange={(userIds) => onChange({ ...value, to: { ...value.to, userIds } })} />
          <div className="field">
            <label htmlFor={msgId}>הודעה</label>
            <input
              id={msgId}
              className="input"
              maxLength={LIMITS.ruleMessage}
              value={value.message}
              aria-describedby={`${msgId}-hint`}
              onChange={(e) => onChange({ ...value, message: e.target.value })}
            />
            <span id={`${msgId}-hint`} className="hint">
              עד {LIMITS.ruleMessage} תווים. נשלחת גם בדוא"ל (למי שלא כיבה התראות דוא"ל). אין לכלול מידע רפואי או אישי רגיש.
            </span>
          </div>
        </>
      );
    }
  }
}

// ---------------------------------------------------------------- editor dialog
export function RuleEditor({ board, rule, open, onClose }: { board: BoardDetail; rule: Automation | null; open: boolean; onClose: () => void }) {
  const { create, update } = useAutomationMutations(board.id);
  const { toast } = useFeedback();
  const fresh = (): Draft => ({ name: '', trigger: defaultTrigger(board, 'item_created'), conditions: [], actions: [] });
  const [draft, setDraft] = useState<Draft>(() => (rule ? { name: rule.name, trigger: rule.trigger, conditions: rule.conditions, actions: rule.actions } : fresh()));
  const [error, setError] = useState<string | null>(null);
  const [newCond, setNewCond] = useState<RuleCondition['type']>('not_done');
  const [newAction, setNewAction] = useState<RuleAction['type']>('notify');
  const nameId = useId();
  const recipeId = useId();
  const condId = useId();
  const actionId = useId();
  const pending = create.isPending || update.isPending;

  const recipes = RECIPES.map((r) => ({ ...r, input: r.build(board) })).filter((r) => r.input);

  const save = () => {
    setError(null);
    const parsed = createAutomationSchema.safeParse({ ...draft, enabled: rule?.enabled ?? true });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(issue?.path[0] === 'name' ? 'יש לתת שם לחוק' : (issue?.message ?? 'יש להשלים את השדות'));
      return;
    }
    const done = () => {
      toast(rule ? 'החוק עודכן' : 'החוק נוצר ומופעל');
      onClose();
    };
    if (rule) update.mutate({ id: rule.id, patch: parsed.data }, { onSuccess: done, onError: (e) => setError(errorMessage(e)) });
    else create.mutate(parsed.data, { onSuccess: done, onError: (e) => setError(errorMessage(e)) });
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={rule ? `עריכת חוק: ${rule.name}` : 'חוק אוטומציה חדש'}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            ביטול
          </button>
          <button type="button" className="btn btn-primary" disabled={pending} onClick={save}>
            {pending ? 'שומר…' : 'שמירה'}
          </button>
        </>
      }
    >
      <div className="rule-editor">
        {!rule && recipes.length > 0 && (
          <div className="field">
            <label htmlFor={recipeId}>התחלה ממתכון (לא חובה)</label>
            <select
              id={recipeId}
              className="select"
              defaultValue=""
              onChange={(e) => {
                const r = recipes.find((x) => x.key === e.target.value)?.input;
                if (r) setDraft({ name: r.name, trigger: r.trigger, conditions: r.conditions ?? [], actions: r.actions } as Draft);
              }}
            >
              <option value="">— בחירת מתכון —</option>
              {recipes.map((r) => (
                <option key={r.key} value={r.key}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="field">
          <label htmlFor={nameId}>שם החוק</label>
          <input id={nameId} className="input" maxLength={80} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </div>

        <fieldset className="rule-block">
          <legend>
            <span className="rule-kw">כאשר</span>
          </legend>
          <TriggerFields board={board} value={draft.trigger} onChange={(trigger) => setDraft({ ...draft, trigger })} />
        </fieldset>

        <fieldset className="rule-block">
          <legend>
            <span className="rule-kw">ורק אם</span> <span className="muted">(לא חובה — כל התנאים)</span>
          </legend>
          {draft.conditions.map((c, i) => (
            <div key={i} className="rule-item">
              <div className="rule-item-head">
                <strong>{CONDITION_LABELS[c.type]}</strong>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`הסרת התנאי ${i + 1}: ${CONDITION_LABELS[c.type]}`}
                  onClick={() => setDraft({ ...draft, conditions: draft.conditions.filter((_, j) => j !== i) })}
                >
                  <Icon name="x" />
                </button>
              </div>
              <ConditionFields board={board} value={c} onChange={(nc) => setDraft({ ...draft, conditions: draft.conditions.map((x, j) => (j === i ? nc : x)) })} />
            </div>
          ))}
          {draft.conditions.length < LIMITS.ruleConditions && (
            <div className="rule-add">
              <label htmlFor={condId} className="sr-only">
                סוג תנאי להוספה
              </label>
              <select id={condId} className="select" value={newCond} onChange={(e) => setNewCond(e.target.value as RuleCondition['type'])}>
                {(Object.keys(CONDITION_LABELS) as RuleCondition['type'][]).map((t) => (
                  <option key={t} value={t} disabled={!isAvailable(board, t)}>
                    {CONDITION_LABELS[t]}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-sm" onClick={() => setDraft({ ...draft, conditions: [...draft.conditions, defaultCondition(board, newCond)] })}>
                <Icon name="plus" /> הוספת תנאי
              </button>
            </div>
          )}
        </fieldset>

        <fieldset className="rule-block">
          <legend>
            <span className="rule-kw">אז</span> <span className="muted">(עד {LIMITS.ruleActions} פעולות, לפי הסדר)</span>
          </legend>
          {draft.actions.length === 0 && <p className="muted">עוד לא נוספו פעולות.</p>}
          {draft.actions.map((a, i) => (
            <div key={i} className="rule-item">
              <div className="rule-item-head">
                <strong>
                  {i + 1}. {ACTION_LABELS[a.type]}
                </strong>
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`הסרת הפעולה ${i + 1}: ${ACTION_LABELS[a.type]}`}
                  onClick={() => setDraft({ ...draft, actions: draft.actions.filter((_, j) => j !== i) })}
                >
                  <Icon name="x" />
                </button>
              </div>
              <ActionFields board={board} value={a} onChange={(na) => setDraft({ ...draft, actions: draft.actions.map((x, j) => (j === i ? na : x)) })} />
            </div>
          ))}
          {draft.actions.length < LIMITS.ruleActions && (
            <div className="rule-add">
              <label htmlFor={actionId} className="sr-only">
                סוג פעולה להוספה
              </label>
              <select id={actionId} className="select" value={newAction} onChange={(e) => setNewAction(e.target.value as RuleAction['type'])}>
                {(Object.keys(ACTION_LABELS) as RuleAction['type'][]).map((t) => (
                  <option key={t} value={t} disabled={!isAvailable(board, t)}>
                    {ACTION_LABELS[t]}
                  </option>
                ))}
              </select>
              <button type="button" className="btn btn-sm" onClick={() => setDraft({ ...draft, actions: [...draft.actions, defaultAction(board, newAction)] })}>
                <Icon name="plus" /> הוספת פעולה
              </button>
            </div>
          )}
        </fieldset>

        {draft.actions.length > 0 && (
          <div className="rule-preview" aria-live="polite">
            <span className="label">תצוגה מקדימה</span>
            <RuleSentence board={board} rule={draft} />
          </div>
        )}
        <p className="hint">שינויים שאוטומציה מבצעת לא מפעילים אוטומציות אחרות (למניעת לולאות). החוקים חלים על פריטים ראשיים בלבד.</p>
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
      </div>
    </Dialog>
  );
}

/** "כאשר … ורק אם … אז …" in plain Hebrew. */
export function RuleSentence({ board, rule }: { board: BoardDetail; rule: Pick<Draft, 'trigger' | 'conditions' | 'actions'> }) {
  return (
    <p className="rule-sentence">
      <span className="rule-kw">כאשר</span> {triggerText(board, rule.trigger)}
      {rule.conditions.length > 0 && (
        <>
          {' '}
          <span className="rule-kw">ורק אם</span> {rule.conditions.map((c) => conditionText(board, c)).join(' וגם ')}
        </>
      )}{' '}
      <span className="rule-kw">אז</span> {rule.actions.map((a) => actionText(board, a)).join('; ')}
    </p>
  );
}
