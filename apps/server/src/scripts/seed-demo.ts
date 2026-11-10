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
  const s = createServices(db, config);
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

  console.log('\nDemo data created. One-time credentials (fictitious users):');
  console.table(creds);
  console.log(`(admin id ${admin.id.slice(0, 8)}…)`);
  db.close();
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
