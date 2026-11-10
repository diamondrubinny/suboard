import { GLOBAL_ROLE_LABELS } from '@suboard/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useBoards } from '../api/hooks';
import { useAuth } from '../auth/AuthContext';
import { A11yToolbar } from './A11yToolbar';
import { LoadingState, useFeedback } from './Feedback';
import { Icon } from './Icon';
import { GlobalSearch } from './GlobalSearch';
import { NotificationsBell } from './NotificationsBell';
import { Avatar } from './StatusPill';

/** SUBoard Spectrum mark (design system asset Logos/suboard-mark.svg) — a tiny colourful board. */
export function Logo() {
  return (
    <svg aria-hidden="true" width="30" height="30" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="16" fill="#2B59F0" />
      <rect x="13" y="15" width="38" height="9" rx="4.5" fill="#FF8A1F" />
      <rect x="13" y="28" width="26" height="9" rx="4.5" fill="#FF6FB0" />
      <rect x="13" y="41" width="32" height="9" rx="4.5" fill="#1FBF75" />
      <circle cx="47" cy="45.5" r="6" fill="#FFC83D" />
    </svg>
  );
}

export function Footer() {
  return (
    <footer className="app-footer">
      <span>© {new Date().getFullYear()} SUBoard · יחידת הבטיחות</span>
      <Link to="/accessibility">הצהרת נגישות</Link>
      <Link to="/privacy">מדיניות פרטיות</Link>
      <Link to="/cookies">הגדרות פרטיות ועוגיות</Link>
      <Link to="/terms">תנאי שימוש</Link>
    </footer>
  );
}

/** Updates document.title and moves focus to the main heading on route change (screen readers). */
export function usePageTitle(title: string) {
  useEffect(() => {
    document.title = `${title} · SUBoard`;
  }, [title]);
}

export function RequireAuth({ admin = false }: { admin?: boolean }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingState />;
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  if ((user.mustChangePassword || user.mfaSetupRequired) && location.pathname !== '/profile') return <Navigate to="/profile" replace />;
  if (admin && user.role !== 'admin') return <Navigate to="/" replace />;
  return <Outlet />;
}

export function Layout() {
  const { user, logout } = useAuth();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const location = useLocation();
  const boards = useBoards();
  const [menuOpen, setMenuOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setMenuOpen(false);
    // Move focus to main content on navigation so keyboard/screen-reader users land in context.
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  if (!user) return null;
  const pending = user.mustChangePassword || user.mfaSetupRequired;

  const onLogout = async () => {
    await logout();
    toast('התנתקת בהצלחה');
    navigate('/login');
  };

  return (
    <div className="app-shell">
      <a href="#main" className="skip-link">
        דילוג לתוכן הראשי
      </a>
      <header className="app-header">
        <button
          type="button"
          className="icon-btn menu-toggle"
          aria-label="תפריט ניווט"
          aria-expanded={menuOpen}
          aria-controls="sidebar"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <Icon name="menu" />
        </button>
        <Link to="/" className="brand">
          <Logo />
          <span>
            SUBoard <small>· יחידת הבטיחות</small>
          </span>
        </Link>
        <span className="header-spacer" />
        <div className="user-chip">
          {!pending && <GlobalSearch />}
          {!pending && <NotificationsBell />}
          <Avatar name={user.name} />
          <Link to="/profile" className="nowrap">
            {user.name}
            <span className="sr-only"> ({GLOBAL_ROLE_LABELS[user.role]}) — פרופיל</span>
          </Link>
          <button type="button" className="icon-btn" onClick={onLogout} aria-label="התנתקות">
            <Icon name="logout" />
          </button>
        </div>
      </header>

      <nav id="sidebar" className="sidebar" aria-label="ניווט ראשי" data-open={menuOpen}>
        {!pending && (
          <>
            <ul className="nav-list">
              <li>
                <NavLink to="/" end className="nav-link">
                  <Icon name="home" /> לוח בקרה
                </NavLink>
              </li>
              <li>
                <NavLink to="/boards" end className="nav-link">
                  <Icon name="boards" /> כל הלוחות
                </NavLink>
              </li>
              <li>
                <NavLink to="/profile" className="nav-link">
                  <Icon name="user" /> הפרופיל שלי
                </NavLink>
              </li>
              {user.role === 'admin' && (
                <>
                  <li>
                    <NavLink to="/admin/users" className="nav-link">
                      <Icon name="users" /> ניהול משתמשים
                    </NavLink>
                  </li>
                  <li>
                    <NavLink to="/admin/audit" className="nav-link">
                      <Icon name="shield" /> יומן אבטחה
                    </NavLink>
                  </li>
                </>
              )}
            </ul>
            <h2 className="nav-section" id="nav-boards">
              הלוחות שלי
            </h2>
            <ul className="nav-list" aria-labelledby="nav-boards">
              {boards.data?.map((b) => (
                <li key={b.id}>
                  <NavLink to={`/boards/${b.id}`} className="nav-link">
                    <Icon name="table" size={16} /> {b.name}
                  </NavLink>
                </li>
              ))}
              {boards.data?.length === 0 && <li className="muted nav-link">אין עדיין לוחות</li>}
            </ul>
          </>
        )}
      </nav>

      <main id="main" ref={mainRef} tabIndex={-1} className="main" style={{ outline: 'none' }}>
        <Outlet />
      </main>
      <Footer />
      <A11yToolbar />
    </div>
  );
}
