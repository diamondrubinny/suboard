import { MODULES, type ModuleKey } from '@suboard/shared';
import { Link, Outlet } from 'react-router-dom';
import { useModules } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { LoadingState } from '../components/Feedback';
import { usePageTitle } from '../components/Layout';

/** Route guard: the nested routes render only while the module is switched on. */
export function ModuleGate({ module }: { module: ModuleKey }) {
  const q = useModules();
  if (q.isPending) return <LoadingState />;
  if (q.data && q.data[module] === false) return <ModuleOff module={module} />;
  return <Outlet />;
}

function ModuleOff({ module }: { module: ModuleKey }) {
  const { user } = useAuth();
  const label = MODULES.find((m) => m.key === module)?.label ?? '';
  usePageTitle('המודול אינו פעיל');
  return (
    <div className="state">
      <h1>המודול "{label}" אינו פעיל</h1>
      <p>מנהל המערכת כיבה את המודול הזה. הנתונים שלו נשמרים ויחזרו כשיופעל מחדש.</p>
      {user?.role === 'admin' ? (
        <Link to="/admin/modules" className="btn btn-primary">
          לניהול המודולים
        </Link>
      ) : (
        <Link to="/" className="btn btn-primary">
          חזרה ללוח הבקרה
        </Link>
      )}
    </div>
  );
}
