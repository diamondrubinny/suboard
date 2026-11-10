import type { ColorKey, ColumnSettings, ColumnType, StatusOption, TemplateInfo } from '@suboard/shared';

interface TemplateColumn {
  title: string;
  type: ColumnType;
  settings?: ColumnSettings;
}

export interface TemplateDef extends TemplateInfo {
  groups: { name: string; color: ColorKey }[];
  columns: TemplateColumn[];
}

const opt = (id: string, label: string, color: ColorKey, done?: boolean): StatusOption =>
  done ? { id, label, color, done } : { id, label, color };

const PRIORITY: TemplateColumn = {
  title: 'עדיפות',
  type: 'status',
  settings: {
    options: [opt('low', 'נמוכה', 'gray'), opt('medium', 'בינונית', 'blue'), opt('high', 'גבוהה', 'orange'), opt('critical', 'קריטית', 'red')],
  },
};

/**
 * Board templates for a safety unit. The first status column of every template is the
 * board's primary status (its `done` options mark an item as closed) and exactly one
 * date column carries `role: "due"` so the dashboard can detect overdue work.
 */
export const TEMPLATES: TemplateDef[] = [
  {
    key: 'incidents',
    name: 'אירועים וכמעט-אירועים',
    description: 'דיווח, בירור ותחקיר של אירועי בטיחות, פגיעות וכמעט-אירועים.',
    icon: 'alert',
    groups: [
      { name: 'דיווחים חדשים', color: 'red' },
      { name: 'בבירור / תחקיר', color: 'amber' },
      { name: 'סגורים', color: 'green' },
    ],
    columns: [
      {
        title: 'סטטוס',
        type: 'status',
        settings: {
          options: [
            opt('new', 'חדש', 'red'),
            opt('investigating', 'בתחקיר', 'amber'),
            opt('awaiting_action', 'ממתין לפעולה מתקנת', 'purple'),
            opt('closed', 'סגור', 'green', true),
          ],
        },
      },
      {
        title: 'חומרה',
        type: 'status',
        settings: {
          options: [opt('low', 'נמוכה', 'gray'), opt('medium', 'בינונית', 'blue'), opt('high', 'גבוהה', 'orange'), opt('critical', 'קריטית', 'red')],
        },
      },
      {
        title: 'סוג אירוע',
        type: 'status',
        settings: {
          options: [
            opt('near_miss', 'כמעט-אירוע', 'teal'),
            opt('injury', 'פגיעה בגוף', 'red'),
            opt('property', 'נזק לרכוש', 'orange'),
            opt('hazmat', 'דליפת חומ"ס', 'purple'),
            opt('fire', 'שריפה / עשן', 'pink'),
            opt('other', 'אחר', 'gray'),
          ],
        },
      },
      { title: 'תאריך האירוע', type: 'date' },
      { title: 'מיקום', type: 'text' },
      { title: 'הערכת סיכון', type: 'risk' },
      { title: 'אחראי בירור', type: 'person' },
      { title: 'יעד לסגירה', type: 'date', settings: { role: 'due' } },
      { title: 'תיאור (ללא פרטים רפואיים)', type: 'long_text' },
    ],
  },
  {
    key: 'lab_surveys',
    name: 'סקרי בטיחות במעבדות',
    description: 'תכנון וביצוע סקרים תקופתיים, ממצאים וציונים.',
    icon: 'clipboard',
    groups: [
      { name: 'רבעון נוכחי', color: 'blue' },
      { name: 'רבעון הבא', color: 'gray' },
    ],
    columns: [
      {
        title: 'סטטוס',
        type: 'status',
        settings: {
          options: [
            opt('planned', 'מתוכנן', 'gray'),
            opt('done_survey', 'בוצע', 'blue'),
            opt('fixes', 'ממתין לתיקונים', 'orange'),
            opt('completed', 'הושלם', 'green', true),
          ],
        },
      },
      { title: 'מבנה / חדר', type: 'text' },
      { title: 'סוקר', type: 'person' },
      { title: 'תאריך סקר', type: 'date', settings: { role: 'due' } },
      { title: 'ציון', type: 'number' },
      {
        title: 'צ\'קליסט סקר',
        type: 'checklist',
        settings: {
          checklist: {
            items: [
              { id: 'exits', label: 'דרכי מילוט פנויות ומסומנות' },
              { id: 'extinguisher', label: 'מטף בתוקף ונגיש' },
              { id: 'shower', label: 'מקלחת חירום ושוטף עיניים תקינים' },
              { id: 'hood', label: 'מנדף כימי — זרימה תקינה ומדבקת בדיקה בתוקף' },
              { id: 'storage', label: 'אחסון חומרים מסוכנים לפי הפרדה' },
              { id: 'labels', label: 'סימון מכלים ותוויות SDS' },
              { id: 'ppe', label: 'ציוד מגן אישי זמין' },
              { id: 'waste', label: 'פסולת כימית מסומנת ומאוחסנת כנדרש' },
            ],
          },
        },
      },
      { title: 'ממצאים', type: 'long_text' },
      { title: 'סקר הבא', type: 'date' },
    ],
  },
  {
    key: 'capa',
    name: 'פעולות מתקנות ומונעות',
    description: 'מעקב אחר ביצוע פעולות מתקנות שעלו מסקרים, אירועים וביקורות.',
    icon: 'wrench',
    groups: [
      { name: 'פתוחות', color: 'orange' },
      { name: 'הושלמו', color: 'green' },
    ],
    columns: [
      {
        title: 'סטטוס',
        type: 'status',
        settings: {
          options: [
            opt('open', 'פתוח', 'gray'),
            opt('in_progress', 'בטיפול', 'blue'),
            opt('verify', 'ממתין לאימות', 'purple'),
            opt('done', 'הושלם', 'green', true),
            opt('cancelled', 'בוטל', 'navy', true),
          ],
        },
      },
      PRIORITY,
      {
        title: 'מקור',
        type: 'status',
        settings: {
          options: [
            opt('survey', 'סקר', 'teal'),
            opt('incident', 'אירוע', 'red'),
            opt('audit', 'ביקורת', 'purple'),
            opt('drill', 'תרגיל', 'blue'),
            opt('other', 'אחר', 'gray'),
          ],
        },
      },
      { title: 'אחראי ביצוע', type: 'person' },
      { title: 'תאריך יעד', type: 'date', settings: { role: 'due' } },
      { title: 'תיאור הפעולה', type: 'long_text' },
    ],
  },
  {
    key: 'trainings',
    name: 'הדרכות בטיחות',
    description: 'תכנון הדרכות, מדריכים, מועדים ומספר משתתפים.',
    icon: 'school',
    groups: [
      { name: 'מתוכננות', color: 'blue' },
      { name: 'בוצעו', color: 'green' },
    ],
    columns: [
      {
        title: 'סטטוס',
        type: 'status',
        settings: {
          options: [opt('planned', 'מתוכנן', 'blue'), opt('held', 'בוצע', 'green', true), opt('postponed', 'נדחה', 'orange'), opt('cancelled', 'בוטל', 'gray', true)],
        },
      },
      {
        title: 'סוג הדרכה',
        type: 'status',
        settings: {
          options: [
            opt('general', 'בטיחות כללית', 'teal'),
            opt('chemical', 'חומרים מסוכנים', 'purple'),
            opt('fire', 'כיבוי אש', 'red'),
            opt('radiation', 'קרינה', 'amber'),
            opt('height', 'עבודה בגובה', 'navy'),
            opt('first_aid', 'עזרה ראשונה', 'pink'),
          ],
        },
      },
      { title: 'מדריך', type: 'person' },
      { title: 'מועד', type: 'date', settings: { role: 'due' } },
      { title: 'מספר משתתפים', type: 'number' },
      { title: 'הערות', type: 'long_text' },
    ],
  },
  {
    key: 'equipment',
    name: 'בדיקות ציוד תקופתיות',
    description: 'מטפים, מנדפים, מקלחות חירום, ארונות חומ"ס וערכות עזרה ראשונה.',
    icon: 'extinguisher',
    groups: [
      { name: 'מבנה ראשי', color: 'teal' },
      { name: 'מבני מעבדות', color: 'purple' },
    ],
    columns: [
      {
        title: 'מצב',
        type: 'status',
        settings: {
          options: [
            opt('ok', 'תקין', 'green', true),
            opt('needs_service', 'דורש טיפול', 'amber'),
            opt('faulty', 'לא תקין', 'red'),
            opt('disabled', 'מושבת', 'gray'),
          ],
        },
      },
      {
        title: 'סוג ציוד',
        type: 'status',
        settings: {
          options: [
            opt('extinguisher', 'מטף', 'red'),
            opt('fume_hood', 'מנדף', 'blue'),
            opt('shower', 'מקלחת / שוטף עיניים', 'teal'),
            opt('hazmat_cabinet', 'ארון חומ"ס', 'purple'),
            opt('first_aid', 'ערכת עזרה ראשונה', 'pink'),
            opt('other', 'אחר', 'gray'),
          ],
        },
      },
      { title: 'מיקום', type: 'text' },
      { title: 'בדיקה אחרונה', type: 'date' },
      { title: 'בדיקה הבאה', type: 'date', settings: { role: 'due' } },
      { title: 'אחראי', type: 'person' },
      { title: 'הערות', type: 'long_text' },
    ],
  },
  {
    key: 'permits',
    name: 'היתרי עבודה',
    description: 'עבודה בחום, בגובה, במקום מוקף ועבודות קבלנים.',
    icon: 'badge',
    groups: [
      { name: 'בקשות', color: 'amber' },
      { name: 'פעילים', color: 'blue' },
      { name: 'סגורים', color: 'gray' },
    ],
    columns: [
      {
        title: 'סטטוס',
        type: 'status',
        settings: {
          options: [
            opt('pending', 'ממתין לאישור', 'amber'),
            opt('approved', 'מאושר', 'blue'),
            opt('active', 'פעיל', 'teal'),
            opt('closed', 'נסגר', 'green', true),
            opt('rejected', 'נדחה', 'red', true),
          ],
        },
      },
      {
        title: 'סוג היתר',
        type: 'status',
        settings: {
          options: [
            opt('hot', 'עבודה בחום', 'red'),
            opt('height', 'עבודה בגובה', 'navy'),
            opt('confined', 'מקום מוקף', 'purple'),
            opt('electrical', 'חשמל', 'amber'),
            opt('contractor', 'קבלן כללי', 'gray'),
          ],
        },
      },
      { title: 'מבצע / קבלן', type: 'text' },
      { title: 'מאשר', type: 'person' },
      { title: 'מתאריך', type: 'date' },
      { title: 'עד תאריך', type: 'date', settings: { role: 'due' } },
      { title: 'אמצעי בטיחות נדרשים', type: 'long_text' },
    ],
  },
  {
    key: 'blank',
    name: 'לוח ריק',
    description: 'לוח בסיסי להתאמה חופשית.',
    icon: 'grid',
    groups: [{ name: 'קבוצה ראשונה', color: 'blue' }],
    columns: [
      {
        title: 'סטטוס',
        type: 'status',
        settings: {
          options: [opt('todo', 'לביצוע', 'gray'), opt('doing', 'בעבודה', 'blue'), opt('stuck', 'תקוע', 'red'), opt('done', 'הושלם', 'green', true)],
        },
      },
      { title: 'אחראי', type: 'person' },
      { title: 'תאריך יעד', type: 'date', settings: { role: 'due' } },
    ],
  },
];

export function getTemplate(key: string): TemplateDef | undefined {
  return TEMPLATES.find((t) => t.key === key);
}

export function listTemplates(): TemplateInfo[] {
  return TEMPLATES.map(({ key, name, description, icon }) => ({ key, name, description, icon }));
}
