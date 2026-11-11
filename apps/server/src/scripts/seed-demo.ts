/**
 * Seeds fictitious demo data for local development / demos. Refuses to run in production.
 * Passwords are random per run and printed once to the console.
 */
import { addDaysIso, todayIso } from '@suboard/shared';
import { randomBytes } from 'node:crypto';
import { loadConfig } from '../config.js';
import { openDatabase } from '../db/index.js';
import { createServices } from '../services/index.js';

async function main() {
  const config = loadConfig();
  if (config.env === 'production') throw new Error('seed-demo is disabled in production');
  const db = openDatabase(config.databasePath);
  // Demo data never sends e-mail (fictitious addresses), even when SMTP is configured.
  const s = createServices(db, config, { mailer: null });
  if (s.users.countUsers() > 0) throw new Error('Database is not empty — seed-demo only runs on a fresh database');

  const pw = () => `Demo-${randomBytes(9).toString('base64url')}`;
  const creds: { email: string; password: string; role: string }[] = [];
  const mk = async (email: string, name: string, role: 'admin' | 'manager' | 'member') => {
    const password = pw();
    creds.push({ email, password, role });
    const u = await s.users.create(null, { email, name, role, password }, { mustChangePassword: false });
    return { id: u.id, name: u.name, role };
  };

  const admin = await mk('admin@demo.local', 'דנה מנהלת מערכת', 'admin');
  const manager = await mk('safety.manager@demo.local', 'יואב ממונה בטיחות', 'manager');
  const member = await mk('surveyor@demo.local', 'נועה סוקרת', 'member');

  const today = todayIso(config.timeZone);
  const d = (n: number) => addDaysIso(today, n);

  const fill = (boardId: string, rows: { group: number; name: string; values: (cols: Record<string, string>) => Record<string, unknown> }[]) => {
    const board = s.boards.get(manager, boardId);
    const cols = Object.fromEntries(board.columns.map((c) => [c.title, c.id]));
    for (const r of rows) {
      const groupId = board.groups[r.group]!.id;
      s.items.create(manager, boardId, { groupId, name: r.name, values: r.values(cols) });
    }
  };

  const incidents = s.boards.create(manager, { name: 'אירועים וכמעט-אירועים 2026', templateKey: 'incidents' });
  s.boards.setMember(manager, incidents.id, member.id, 'editor');
  fill(incidents.id, [
    { group: 0, name: 'החלקה במסדרון קומה 2 ליד מכונת הקפה', values: (c) => ({ [c['סטטוס']!]: 'new', [c['חומרה']!]: 'medium', [c['סוג אירוע']!]: 'near_miss', [c['תאריך האירוע']!]: d(-2), [c['מיקום']!]: 'בניין A, קומה 2', [c['אחראי בירור']!]: [member.id], [c['יעד לסגירה']!]: d(5) }) },
    { group: 1, name: 'דליפה קטנה של ממס אורגני במנדף 3', values: (c) => ({ [c['סטטוס']!]: 'investigating', [c['חומרה']!]: 'high', [c['סוג אירוע']!]: 'hazmat', [c['תאריך האירוע']!]: d(-12), [c['מיקום']!]: 'מעבדה 214', [c['אחראי בירור']!]: [manager.id], [c['יעד לסגירה']!]: d(-3) }) },
    { group: 2, name: 'הפעלת גלאי עשן בעקבות טוסטר', values: (c) => ({ [c['סטטוס']!]: 'closed', [c['חומרה']!]: 'low', [c['סוג אירוע']!]: 'fire', [c['תאריך האירוע']!]: d(-30), [c['יעד לסגירה']!]: d(-20) }) },
  ]);

  const capa = s.boards.create(manager, { name: 'פעולות מתקנות', templateKey: 'capa' });
  s.boards.setMember(manager, capa.id, member.id, 'editor');
  fill(capa.id, [
    { group: 0, name: 'התקנת שטיח מונע החלקה ליד מכונת הקפה', values: (c) => ({ [c['סטטוס']!]: 'in_progress', [c['עדיפות']!]: 'medium', [c['מקור']!]: 'incident', [c['אחראי ביצוע']!]: [member.id], [c['תאריך יעד']!]: d(3) }) },
    { group: 0, name: 'החלפת אטם במנדף 3 ובדיקת זרימה', values: (c) => ({ [c['סטטוס']!]: 'open', [c['עדיפות']!]: 'critical', [c['מקור']!]: 'incident', [c['אחראי ביצוע']!]: [manager.id], [c['תאריך יעד']!]: d(-1) }) },
    { group: 1, name: 'שילוט יציאות חירום בבניין C', values: (c) => ({ [c['סטטוס']!]: 'done', [c['עדיפות']!]: 'high', [c['מקור']!]: 'audit', [c['תאריך יעד']!]: d(-15) }) },
  ]);

  const equipment = s.boards.create(manager, { name: 'בדיקות ציוד תקופתיות', templateKey: 'equipment' });
  s.boards.setMember(manager, equipment.id, member.id, 'viewer');
  fill(equipment.id, [
    { group: 0, name: 'מטף אבקה 6 ק"ג — לובי', values: (c) => ({ [c['מצב']!]: 'ok', [c['סוג ציוד']!]: 'extinguisher', [c['מיקום']!]: 'לובי כניסה', [c['בדיקה אחרונה']!]: d(-170), [c['בדיקה הבאה']!]: d(10) }) },
    { group: 1, name: 'מקלחת חירום — מעבדה 214', values: (c) => ({ [c['מצב']!]: 'needs_service', [c['סוג ציוד']!]: 'shower', [c['מיקום']!]: 'מעבדה 214', [c['בדיקה הבאה']!]: d(-4), [c['אחראי']!]: [member.id] }) },
  ]);

  // Wave C: periodic compliance on the equipment board (by location).
  const eqCols = Object.fromEntries(s.boards.columns(equipment.id).map((c) => [c.title, c.id]));
  s.compliance.configure(manager, equipment.id, { dateColumnId: eqCols['בדיקה הבאה']!, groupByColumnId: eqCols['מיקום']!, windowDays: 30 });

  // Wave C: a lab-survey board whose checklist opens corrective actions on the CAPA board.
  const surveys = s.boards.create(manager, { name: 'סקרי בטיחות במעבדות', templateKey: 'lab_surveys' });
  s.boards.setMember(manager, surveys.id, member.id, 'editor');
  const checklist = s.boards.columns(surveys.id).find((c) => c.type === 'checklist')!;
  s.boards.updateColumn(manager, checklist.id, { settings: { checklist: { ...checklist.settings.checklist!, capaBoardId: capa.id, capaGroupId: null } } });
  fill(surveys.id, [
    { group: 0, name: 'מעבדה 214 — כימיה אורגנית', values: (c) => ({ [c['סטטוס']!]: 'planned', [c['מבנה / חדר']!]: 'בניין A, 214', [c['סוקר']!]: [member.id], [c['תאריך סקר']!]: d(2) }) },
  ]);

  // Wave C: a near-miss report form open to every signed-in user.
  const incCols = s.boards.columns(incidents.id);
  const byTitle = (t: string) => incCols.find((c) => c.title === t)!.id;
  s.forms.create(manager, incidents.id, {
    name: 'דיווח כמעט-אירוע',
    description: 'ראית מפגע או כמעט-אירוע? דווח/י כאן — הדיווח מגיע ליחידת הבטיחות.',
    groupId: s.boards.get(manager, incidents.id).groups[0]!.id,
    nameLabel: 'מה קרה? (במשפט)',
    fields: [
      { columnId: byTitle('סוג אירוע'), required: true, label: 'סוג' },
      { columnId: byTitle('מיקום'), required: true },
      { columnId: byTitle('תאריך האירוע'), required: false },
      { columnId: byTitle('תיאור (ללא פרטים רפואיים)'), required: false, help: 'ללא שמות נפגעים או מידע רפואי' },
    ],
    audience: 'all_users',
    allowPhotos: true,
    enabled: true,
  });

  // Wave D: a shared management dashboard and one dependency on the CAPA board.
  s.dashboards.create(manager, {
    name: 'מבט יחידת הבטיחות',
    shared: true,
    widgets: [
      { id: 'wopen001', type: 'count', metric: 'open', boardIds: [], size: 's' },
      { id: 'wover001', type: 'count', metric: 'overdue', boardIds: [], size: 's' },
      { id: 'wclos001', type: 'count', metric: 'closed_month', boardIds: [], size: 's' },
      { id: 'wtrnd001', type: 'trend', boardIds: [], period: 'week', count: 8, size: 'l' },
      { id: 'wlate001', type: 'overdue', boardIds: [], limit: 10, size: 'm' },
      { id: 'wload001', type: 'workload', boardIds: [], size: 'm' },
      { id: 'wcomp001', type: 'compliance', boardIds: [], size: 'm' },
      { id: 'wrisk001', type: 'risk', boardIds: [], size: 'm' },
    ],
  });
  const capaItems = s.boards.get(manager, capa.id).items.filter((i) => !i.parentId);
  if (capaItems.length >= 2) s.dependencies.set(manager, capaItems[1]!.id, [capaItems[0]!.id]);

  // Wave E: trainings, a procedure, hazmat inventory and a hazards board.
  const fireTraining = s.trainings.create(manager, { name: 'כיבוי אש ושימוש במטף', description: '', validityMonths: 12, allUsers: true });
  const chemTraining = s.trainings.create(manager, { name: 'עבודה בטוחה עם חומרים מסוכנים', description: '', validityMonths: 24, allUsers: false });
  s.trainings.setRequirements(manager, chemTraining.id, [member.id]);
  s.trainings.addRecords(manager, fireTraining.id, { userIds: [member.id], completedOn: d(-350), note: '' });
  s.trainings.addRecords(manager, fireTraining.id, { userIds: [manager.id], completedOn: d(-100), note: '' });

  const proc = s.procedures.create(manager, { code: 'SAF-001', title: 'עבודה בחום', category: 'עבודות מסוכנות', audience: 'all', userIds: [] });
  s.procedures.publish(manager, proc.id, {
    version: '1.0',
    effectiveOn: today,
    summary: 'גרסה ראשונה',
    body: '1. כל עבודה בחום מחייבת היתר מאושר.\n2. יש לפנות חומרים דליקים ברדיוס 10 מטר.\n3. צופה אש נוכח במהלך העבודה ו-30 דקות אחריה.',
    link: null,
  });

  const hazmat = s.boards.create(manager, { name: 'מלאי חומרים מסוכנים', templateKey: 'hazmat' });
  s.boards.setMember(manager, hazmat.id, member.id, 'editor');
  fill(hazmat.id, [
    { group: 0, name: 'אצטון', values: (c) => ({ [c['מספר CAS']!]: '67-64-1', [c['מעבדה / חדר']!]: 'מעבדה 214', [c['כמות']!]: 4, [c['יחידה']!]: 'l', [c['סיווג GHS']!]: ['flammable', 'irritant'], [c['סקירת SDS הבאה']!]: d(20), [c['מצב']!]: 'ok' }) },
    { group: 0, name: 'חומצה חנקתית 65%', values: (c) => ({ [c['מספר CAS']!]: '7697-37-2', [c['מעבדה / חדר']!]: 'מעבדה 110', [c['כמות']!]: 1, [c['יחידה']!]: 'l', [c['סיווג GHS']!]: ['oxidizer', 'corrosive'], [c['סקירת SDS הבאה']!]: d(-3), [c['מצב']!]: 'low' }) },
  ]);

  const hazards = s.boards.create(manager, { name: 'מפגעים ותוכניות קומה', templateKey: 'hazards' });
  s.boards.setMember(manager, hazards.id, member.id, 'editor');
  fill(hazards.id, [
    { group: 0, name: 'בניין A — קומה 2', values: () => ({}) },
    { group: 1, name: 'כבל מאריך על הרצפה במסדרון', values: (c) => ({ [c['סטטוס']!]: 'open', [c['הערכת סיכון']!]: { l: 3, s: 3 }, [c['מבנה / קומה']!]: 'A / 2' }) },
    { group: 1, name: 'יציאת חירום חסומה בארגזים', values: (c) => ({ [c['סטטוס']!]: 'handling', [c['הערכת סיכון']!]: { l: 3, s: 5 }, [c['מבנה / קומה']!]: 'A / 2' }) },
  ]);

  console.log('\nDemo data created. One-time credentials (fictitious users):');
  console.table(creds);
  console.log(`(admin id ${admin.id.slice(0, 8)}…)`);
  db.close();
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
