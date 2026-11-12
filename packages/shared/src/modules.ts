/**
 * Optional modules. The core (boards, items, "my work", notifications, users, security) is always on;
 * everything listed here can be switched off by a system administrator. A switched-off module
 * disappears from the navigation and its API answers 404 — its data stays in the database and comes
 * back when the module is switched on again.
 *
 * One registry for both sides: the server guards `api` prefixes, the web app builds its navigation
 * and route guards from the same keys.
 */
export const MODULE_KEYS = ['forms', 'dashboards', 'workload', 'monthly_report', 'trainings', 'procedures', 'compliance'] as const;
export type ModuleKey = (typeof MODULE_KEYS)[number];

export interface ModuleDefinition {
  key: ModuleKey;
  label: string;
  description: string;
  /** API paths (after `/api`) that belong to the module: exact path or a prefix followed by `/`. */
  api: string[];
  /** API paths that are a pattern rather than a prefix (e.g. nested under a board). */
  apiPatterns?: RegExp[];
}

export const MODULES: readonly ModuleDefinition[] = [
  {
    key: 'forms',
    label: 'טפסים ודיווחים',
    description: 'יוצר טפסים, קישור וקוד QR לטופס, "הדיווחים שלי".',
    api: ['/forms'],
    apiPatterns: [/^\/boards\/[^/]+\/forms(\/|$)/],
  },
  { key: 'dashboards', label: 'דשבורדים', description: 'לוחות מחוונים מותאמים עם גרפים חוצי-לוחות.', api: ['/dashboards', '/analytics'] },
  { key: 'workload', label: 'עומס צוות', description: 'חלוקת המשימות הפתוחות בין אנשי הצוות.', api: ['/workload'] },
  { key: 'monthly_report', label: 'מבט מנהל', description: 'דוח חודשי למנהלים (במסך ובדוא"ל).', api: ['/reports/monthly'] },
  { key: 'trainings', label: 'הדרכות', description: 'הדרכות, מטריצת כשירות ותזכורות לפני פקיעה.', api: ['/trainings', '/training-records', '/me/trainings'] },
  { key: 'procedures', label: 'נהלים', description: 'נהלים בגרסאות ואישורי קריאה.', api: ['/procedures', '/procedure-versions', '/me/procedures'] },
  { key: 'compliance', label: 'תאימות', description: 'מעקב בדיקות תקופתיות ואחוז עמידה.', api: ['/compliance'] },
];

export type ModuleState = Record<ModuleKey, boolean>;

export const allModulesOn = (): ModuleState => Object.fromEntries(MODULE_KEYS.map((k) => [k, true])) as ModuleState;

/** The module an API path (without `/api` and without the query string) belongs to, if any. */
export function moduleOfApiPath(path: string): ModuleKey | null {
  for (const m of MODULES) {
    if (m.api.some((p) => path === p || path.startsWith(`${p}/`))) return m.key;
    if (m.apiPatterns?.some((re) => re.test(path))) return m.key;
  }
  return null;
}
