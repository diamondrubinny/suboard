import type { GlobalRole, ModuleKey } from '@suboard/shared';
import type { IconName } from '../components/Icon';

/**
 * The single place that says what the app's sections are. The side menu, the command palette and
 * the route guards are all built from this list, so adding a section means adding one entry here
 * (plus its routes) — nothing else has to know about it.
 */
export interface NavEntry {
  /** Stable id (also the React key). */
  id: string;
  label: string;
  icon: IconName;
  /** Route path; a function when it depends on the user's role. */
  to: string | ((role: GlobalRole) => string);
  /** Exact-match highlighting (for paths that are prefixes of others). */
  end?: boolean;
  /** Optional module the entry belongs to; hidden when an administrator switched the module off. */
  module?: ModuleKey;
  /** Roles that see the entry; everyone when omitted (the server enforces access regardless). */
  roles?: GlobalRole[];
  /** Extra words the command palette matches. */
  keywords?: string;
  section: 'main' | 'admin';
}

export const NAV: readonly NavEntry[] = [
  { id: 'home', label: 'לוח בקרה', icon: 'home', to: '/', end: true, keywords: 'בית ראשי', section: 'main' },
  { id: 'my-work', label: 'המשימות שלי', icon: 'checks', to: '/my-work', keywords: 'משימות שלי action items תת-פריטים', section: 'main' },
  { id: 'boards', label: 'כל הלוחות', icon: 'boards', to: '/boards', end: true, section: 'main' },
  { id: 'dashboards', label: 'דשבורדים', icon: 'chart', to: '/dashboards', module: 'dashboards', keywords: 'גרפים', section: 'main' },
  { id: 'workload', label: 'עומס צוות', icon: 'users', to: '/workload', module: 'workload', section: 'main' },
  { id: 'monthly', label: 'מבט מנהל', icon: 'history', to: '/reports/monthly', module: 'monthly_report', roles: ['admin', 'manager'], keywords: 'דוח חודשי', section: 'main' },
  { id: 'trainings', label: 'הדרכות', icon: 'school', to: (role) => (role === 'member' ? '/trainings/me' : '/trainings'), module: 'trainings', section: 'main' },
  { id: 'procedures', label: 'נהלים', icon: 'clipboard', to: '/procedures', module: 'procedures', section: 'main' },
  { id: 'compliance', label: 'תאימות', icon: 'checks', to: '/compliance', module: 'compliance', section: 'main' },
  { id: 'forms', label: 'טפסים ודיווחים', icon: 'clipboard', to: '/forms', module: 'forms', section: 'main' },
  { id: 'profile', label: 'הפרופיל שלי', icon: 'user', to: '/profile', keywords: 'סיסמה אימות דו-שלבי חיבורים מכשירים מפתח גישה passkey', section: 'main' },
  { id: 'admin-users', label: 'ניהול משתמשים', icon: 'users', to: '/admin/users', roles: ['admin'], section: 'admin' },
  { id: 'admin-modules', label: 'מודולים', icon: 'grid', to: '/admin/modules', roles: ['admin'], keywords: 'הפעלה כיבוי הגדרות מערכת', section: 'admin' },
  { id: 'admin-audit', label: 'יומן אבטחה', icon: 'shield', to: '/admin/audit', roles: ['admin'], section: 'admin' },
];

export const pathOf = (e: NavEntry, role: GlobalRole): string => (typeof e.to === 'function' ? e.to(role) : e.to);

/** Entries a user sees: by role and by the modules that are switched on. */
export function visibleNav(role: GlobalRole | undefined, modules: Partial<Record<ModuleKey, boolean>> | undefined): NavEntry[] {
  return NAV.filter((e) => (!e.roles || (role !== undefined && e.roles.includes(role))) && (!e.module || modules?.[e.module] !== false));
}
