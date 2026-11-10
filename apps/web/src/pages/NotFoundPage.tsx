import { Link } from 'react-router-dom';
import { usePageTitle } from '../components/Layout';

export function NotFoundPage() {
  usePageTitle('הדף לא נמצא');
  return (
    <div className="state">
      <h1>הדף לא נמצא</h1>
      <p>ייתכן שהקישור שגוי, שהמשאב נמחק, או שאין לך הרשאת גישה אליו.</p>
      <Link to="/" className="btn btn-primary">
        חזרה ללוח הבקרה
      </Link>
    </div>
  );
}
