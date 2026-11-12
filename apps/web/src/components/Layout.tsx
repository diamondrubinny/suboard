import { GLOBAL_ROLE_LABELS } from '@suboard/shared';
import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useBoards, useModules, useWorkspaces } from '../api/hooks';
import { pathOf, visibleNav, type NavEntry } from '../modules/registry';
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

const SIDEBAR_KEY = 'suboard:sidebar-hidden';

export function Layout() {
  const { user, logout } = useAuth();
  const { toast } = useFeedback();
  const navigate = useNavigate();
  const location = useLocation();
  const boards = useBoards();
  const favorites = (boards.data ?? []).filter((b) => b.favorite);
  const others = (boards.data ?? []).filter((b) => !b.favorite);
  const workspaces = useWorkspaces();
  // Boards that are not favourites, under their workspace; boards without one come last.
  const boardSections = [
    ...(workspaces.data ?? []).map((w) => ({ id: w.id, name: w.name, boards: others.filter((b) => b.workspaceId === w.id) })),
    { id: 'none', name: (workspaces.data ?? []).length ? 'לוחות נוספים' : favorites.length > 0 ? 'שאר הלוחות' : 'הלוחות שלי', boards: others.filter((b) => !b.workspaceId || !(workspaces.data ?? []).some((w) => w.id === b.workspaceId)) },
  ].filter((sec) => sec.boards.length > 0);
  const [menuOpen, setMenuOpen] = useState(false);
  // Wide screens: the side menu can be hidden to give the board the full width (remembered per browser).
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(SIDEBAR_KEY) === '1';
    } catch {
      return false;
    }
  });
  const pendingSetup = Boolean(user && (user.mustChangePassword || user.mfaSetupRequired));
  const modules = useModules(Boolean(user) && !pendingSetup);
  const toggleMenu = () => {
    if (window.matchMedia('(max-width: 900px)').matches) return setMenuOpen((o) => !o);
    setCollapsed((c) => {
      try {
        localStorage.setItem(SIDEBAR_KEY, c ? '0' : '1');
      } catch {
        /* private mode: the choice lasts for this visit only */
      }
      return !c;
    });
  };
  const mainRef = useRef<HTMLElement>(null);
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 900px)').matches);
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 900px)');
    const on = () => setNarrow(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    setMenuOpen(false);
    // Move focus to main content on navigation so keyboard/screen-reader users land in context.
    mainRef.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [location.pathname]);

  if (!user) return null;
  const pending = pendingSetup;
  const nav = visibleNav(user.role, modules.data);
  const navItem = (e: NavEntry) => (
    <li key={e.id}>
      <NavLink to={pathOf(e, user.role)} end={e.end} className="nav-link">
        <Icon name={e.icon} /> {e.label}
      </NavLink>
    </li>
  );

  const onLogout = async () => {
    await logout();
    toast('התנתקת בהצלחה');
    navigate('/login');
  };

  return (
    <div className="app-shell" data-sidebar={collapsed ? 'hidden' : 'shown'}>
      <a href="#main" className="skip-link">
        דילוג לתוכן הראשי
      </a>
      <header className="app-header">
        <button
          type="button"
          className="icon-btn menu-toggle"
          aria-label="תפריט ניווט"
          title={collapsed ? 'הצגת התפריט' : 'הסתרת התפריט'}
          aria-expanded={narrow ? menuOpen : !collapsed}
          aria-controls="sidebar"
          onClick={toggleMenu}
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
              {nav.filter((e) => e.section === 'main').map(navItem)}
              {nav.filter((e) => e.section === 'admin').map(navItem)}
            </ul>
            {favorites.length > 0 && (
              <>
                <h2 className="nav-section" id="nav-favorites">
                  מועדפים
                </h2>
                <ul className="nav-list" aria-labelledby="nav-favorites">
                  {favorites.map((b) => (
                    <li key={b.id}>
                      <NavLink to={`/boards/${b.id}`} className="nav-link">
                        <Icon name="star" size={16} filled /> {b.name}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {boardSections.map((sec) => (
              <div key={sec.id}>
                <h2 className="nav-section" id={`nav-ws-${sec.id}`}>
                  {sec.name}
                </h2>
                <ul className="nav-list" aria-labelledby={`nav-ws-${sec.id}`}>
                  {sec.boards.map((b) => (
                    <li key={b.id}>
                      <NavLink to={`/boards/${b.id}`} className="nav-link">
                        <Icon name="table" size={16} /> {b.name}
                      </NavLink>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {boards.data?.length === 0 && <p className="muted nav-link">אין עדיין לוחות</p>}
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
