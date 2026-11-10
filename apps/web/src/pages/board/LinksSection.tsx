import { Link } from 'react-router-dom';
import { useItemLinks } from '../../api/hooks';
import { StatusPill } from '../../components/StatusPill';

/** Linked items (checklist → corrective action, investigation → action), both directions. */
export function LinksSection({ itemId }: { itemId: string }) {
  const q = useItemLinks(itemId);
  if (q.isPending || q.isError || !q.data.length) return null;
  return (
    <section className="links-section" aria-labelledby={`links-${itemId}`}>
      <h3 id={`links-${itemId}`}>פריטים מקושרים</h3>
      <ul className="list-plain">
        {q.data.map((l) => (
          <li key={l.id} className="link-row">
            <span className="muted link-kind">
              {l.kind === 'checklist_capa' ? (l.direction === 'out' ? 'פעולה מתקנת מצ\'קליסט' : 'נפתח מצ\'קליסט של') : l.direction === 'out' ? 'פעולה מתקנת מתחקיר' : 'נפתח מתחקיר של'}
            </span>
            {l.item ? (
              <>
                <Link to={`/boards/${l.item.boardId}?item=${l.item.id}`}>{l.item.name}</Link>
                <span className="muted">({l.item.boardName})</span>
                {l.item.statusLabel && <StatusPill label={l.item.statusLabel} color={l.item.statusColor} />}
              </>
            ) : (
              <span className="muted">פריט בלוח שאין לך גישה אליו</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

