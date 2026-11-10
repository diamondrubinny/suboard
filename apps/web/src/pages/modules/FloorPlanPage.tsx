import { findPrimaryStatusColumn, isRiskValue, RISK_LEVEL_LABELS, riskLevel, riskScore, type PlanPin } from '@suboard/shared';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { errorMessage } from '../../api/client';
import { useBoard, usePins, usePlans, useSavePins } from '../../api/hooks';
import { ErrorState, LoadingState, useFeedback } from '../../components/Feedback';
import { Icon } from '../../components/Icon';
import { usePageTitle } from '../../components/Layout';
import { colorStyle } from '../../components/StatusPill';

/** Plans of a board: clean image attachments; pick one to view / pin. */
export function FloorPlansPage() {
  const { boardId = '' } = useParams();
  const board = useBoard(boardId);
  const plans = usePlans(boardId);
  usePageTitle(`תוכניות קומה — ${board.data?.name ?? ''}`);
  return (
    <>
      <div className="page-header">
        <div>
          <h1>תוכניות קומה: {board.data?.name}</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            תוכנית = תמונה (PNG / JPG / WEBP) שצורפה לפריט בלוח ועברה סריקת נוזקות. על התוכנית נועצים את פריטי הלוח (למשל מפגעים).
          </p>
        </div>
        <div className="actions">
          <Link to={`/boards/${boardId}`} className="btn">
            חזרה ללוח
          </Link>
        </div>
      </div>
      {plans.isPending && <LoadingState />}
      {plans.isError && <ErrorState message={errorMessage(plans.error)} onRetry={() => plans.refetch()} />}
      {plans.data?.length === 0 && (
        <div className="empty-state">
          <Icon name="grid" />
          <p>אין עדיין תוכניות. פתחו פריט (למשל "בניין A — קומה 2"), ובלשונית "קבצים" צרפו תמונה של התוכנית.</p>
        </div>
      )}
      <ul className="list-plain grid grid-cards">
        {plans.data?.map((p) => (
          <li key={p.id} className="card dash-card">
            <h2 style={{ margin: 0, fontSize: '1rem' }}>
              <Link to={`/boards/${boardId}/plans/${p.id}`}>{p.itemName}</Link>
            </h2>
            <p className="muted">
              {p.name} · {p.pins} נעיצות
            </p>
          </li>
        ))}
      </ul>
    </>
  );
}

export function FloorPlanPage() {
  const { boardId = '', attachmentId = '' } = useParams();
  const board = useBoard(boardId);
  const pinsQ = usePins(attachmentId);
  const plans = usePlans(boardId);
  const save = useSavePins(attachmentId, boardId);
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const [pins, setPins] = useState<PlanPin[]>([]);
  const [dirty, setDirty] = useState(false);
  const [editing, setEditing] = useState(false);
  const [placing, setPlacing] = useState('');
  const imgRef = useRef<HTMLDivElement>(null);
  const selId = useId();
  const plan = plans.data?.find((p) => p.id === attachmentId);
  usePageTitle(plan ? `תוכנית: ${plan.itemName}` : 'תוכנית קומה');
  const pinsKey = JSON.stringify(pinsQ.data ?? []);
  useEffect(() => {
    if (pinsQ.data) {
      setPins(pinsQ.data);
      setDirty(false);
    }
  }, [pinsKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (board.isPending || pinsQ.isPending) return <LoadingState />;
  if (board.isError) return <ErrorState message={errorMessage(board.error)} onRetry={() => board.refetch()} />;
  if (pinsQ.isError) return <ErrorState message={errorMessage(pinsQ.error)} onRetry={() => pinsQ.refetch()} />;
  const b = board.data;
  const canEdit = b.myRole !== 'viewer';
  const status = findPrimaryStatusColumn(b.columns);
  const risk = b.columns.find((c) => c.type === 'risk');
  const itemOf = (id: string) => b.items.find((i) => i.id === id);
  const candidates = b.items.filter((i) => !i.parentId && i.id !== plan?.itemId && !pins.some((p) => p.itemId === i.id));
  const describe = (id: string) => {
    const it = itemOf(id);
    if (!it) return { name: 'פריט שנמחק', color: null as never, text: '' };
    const opt = status?.settings.options?.find((o) => o.id === it.values[status.id]);
    const rv = risk ? it.values[risk.id] : undefined;
    const r = isRiskValue(rv) ? `סיכון ${riskScore(rv)} ${RISK_LEVEL_LABELS[riskLevel(riskScore(rv))]}` : '';
    return { name: it.name, color: opt?.color ?? 'gray', text: [opt?.label, r].filter(Boolean).join(' · ') };
  };
  const update = (next: PlanPin[]) => {
    setPins(next);
    setDirty(true);
  };
  const place = (e: MouseEvent<HTMLDivElement>) => {
    if (!editing || !placing || !imgRef.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100));
    const y = Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100));
    update([...pins, { itemId: placing, x, y }]);
    setPlacing('');
  };
  const onPinKey = (e: KeyboardEvent<HTMLButtonElement>, idx: number) => {
    if (!editing) return;
    const step = e.shiftKey ? 5 : 1;
    // RTL page, but the plan is a picture: arrows move in screen directions.
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key as 'ArrowLeft'];
    if (d) {
      e.preventDefault();
      update(pins.map((p, i) => (i === idx ? { ...p, x: Math.max(0, Math.min(100, p.x + d[0]!)), y: Math.max(0, Math.min(100, p.y + d[1]!)) } : p)));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      update(pins.filter((_, i) => i !== idx));
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>תוכנית: {plan?.itemName ?? ''}</h1>
          <p className="muted" style={{ margin: 'var(--space-1) 0 0' }}>
            {b.name} · {pins.length} נעיצות{dirty ? ' · יש שינויים שלא נשמרו' : ''}
          </p>
        </div>
        <div className="actions no-print">
          {canEdit && (
            <button type="button" className="btn" aria-pressed={editing} onClick={() => setEditing((x) => !x)}>
              <Icon name="gear" /> {editing ? 'סיום עריכה' : 'עריכת נעיצות'}
            </button>
          )}
          {dirty && (
            <button type="button" className="btn btn-primary" disabled={save.isPending} onClick={() => save.mutate(pins, { onSuccess: () => toast('הנעיצות נשמרו'), onError: (e) => toast(errorMessage(e), 'error') })}>
              שמירה
            </button>
          )}
          <button type="button" className="btn" onClick={() => window.print()}>
            <Icon name="printer" /> הדפסה
          </button>
          <Link to={`/boards/${boardId}/plans`} className="btn">
            כל התוכניות
          </Link>
        </div>
      </div>
      {editing && (
        <div className="toolbar no-print">
          <label htmlFor={selId}>נעיצת פריט:</label>
          <select id={selId} className="select" value={placing} onChange={(e) => setPlacing(e.target.value)}>
            <option value="">— בחירת פריט —</option>
            {candidates.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </select>
          <span className="muted" role="status">
            {placing ? 'לחצו על התוכנית במקום המפגע.' : 'בחרו פריט ואז לחצו על התוכנית. נעיצה קיימת: מקשי חצים להזזה (Shift = צעד גדול), Delete להסרה.'}
          </span>
        </div>
      )}
      <div className="plan-layout">
        <div className={`plan-canvas${placing ? ' placing' : ''}`} ref={imgRef} onClick={place}>
          <img src={`/api/attachments/${attachmentId}/download`} alt={`תוכנית קומה: ${plan?.itemName ?? ''}. הנעיצות מפורטות ברשימה.`} draggable={false} />
          {pins.map((p, i) => {
            const d = describe(p.itemId);
            return (
              <button
                key={p.itemId}
                type="button"
                className="plan-pin"
                style={{ ...colorStyle(d.color), left: `${p.x}%`, top: `${p.y}%` }}
                aria-label={`${i + 1}. ${d.name}${d.text ? ` — ${d.text}` : ''}${editing ? ' (חצים להזזה, Delete להסרה)' : ' — פתיחת הפריט'}`}
                onKeyDown={(e) => onPinKey(e, i)}
                onClick={(e) => {
                  e.stopPropagation();
                  if (!editing) navigate(`/boards/${boardId}?item=${p.itemId}`);
                }}
              >
                {i + 1}
              </button>
            );
          })}
        </div>
        <section className="card plan-list" aria-labelledby="pins-h">
          <h2 id="pins-h">נעיצות</h2>
          {pins.length === 0 ? (
            <p className="muted">{canEdit ? 'אין נעיצות. "עריכת נעיצות" כדי להתחיל.' : 'אין נעיצות.'}</p>
          ) : (
            <ol className="report-items">
              {pins.map((p, i) => {
                const d = describe(p.itemId);
                return (
                  <li key={p.itemId}>
                    <span className="plan-pin static" style={colorStyle(d.color)} aria-hidden="true">
                      {i + 1}
                    </span>{' '}
                    <Link to={`/boards/${boardId}?item=${p.itemId}`}>{d.name}</Link> {d.text && <span className="muted">· {d.text}</span>}
                    {editing && (
                      <button type="button" className="icon-btn no-print" aria-label={`הסרת הנעיצה של ${d.name}`} onClick={() => update(pins.filter((_, j) => j !== i))}>
                        <Icon name="x" size={16} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </div>
    </>
  );
}
