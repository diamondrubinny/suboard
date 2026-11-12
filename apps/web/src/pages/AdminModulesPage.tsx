import { MODULES, type ModuleKey } from '@suboard/shared';
import { errorMessage } from '../api/client';
import { useModules, useSetModules } from '../api/hooks';
import { ErrorState, LoadingState, useFeedback } from '../components/Feedback';
import { usePageTitle } from '../components/Layout';

/** System administrator: switch optional modules on and off for everyone. */
export function AdminModulesPage() {
  usePageTitle('מודולים');
  const q = useModules();
  const set = useSetModules();
  const { toast, confirm } = useFeedback();

  const toggle = async (key: ModuleKey, label: string, on: boolean) => {
    if (!on && !(await confirm({ title: `כיבוי המודול "${label}"`, message: 'המודול ייעלם מהתפריט של כל המשתמשים ולא יהיה נגיש. הנתונים שלו נשמרים ויחזרו כשיופעל מחדש.', confirmLabel: 'כיבוי' }))) return;
    set.mutate({ [key]: on }, { onSuccess: () => toast(on ? `המודול "${label}" הופעל` : `המודול "${label}" כובה`), onError: (e) => toast(errorMessage(e), 'error') });
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1>מודולים</h1>
          <p className="muted">הפעילו רק את מה שהיחידה משתמשת בו. לוחות, פריטים, "המשימות שלי", התראות וניהול משתמשים פעילים תמיד.</p>
        </div>
      </div>
      {q.isPending && <LoadingState />}
      {q.isError && <ErrorState message={errorMessage(q.error)} onRetry={() => q.refetch()} />}
      {q.data && (
        <ul className="list-plain module-list">
          {MODULES.map((m) => {
            const on = q.data[m.key] !== false;
            return (
              <li key={m.key} className="card module-row">
                <div>
                  <h2 id={`mod-${m.key}`}>{m.label}</h2>
                  <p className="muted" id={`mod-${m.key}-d`}>
                    {m.description}
                  </p>
                </div>
                <label className="switch">
                  <input
                    type="checkbox"
                    role="switch"
                    checked={on}
                    disabled={set.isPending}
                    aria-labelledby={`mod-${m.key}`}
                    aria-describedby={`mod-${m.key}-d`}
                    onChange={(e) => void toggle(m.key, m.label, e.target.checked)}
                  />
                  <span aria-hidden="true">{on ? 'פעיל' : 'כבוי'}</span>
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
