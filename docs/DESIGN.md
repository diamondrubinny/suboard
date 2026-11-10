# עיצוב — SUBoard Spectrum

מקור האמת לעיצוב הוא מערכת העיצוב **SUBoard Spectrum** ב-claude.ai Design:
https://claude.ai/artifact/ALsm6bLsE2AwqWCd6qvBQh (גרסה 9, 10/11/2026 — כולל רכיבי גל A).

## איך הקוד מחובר למערכת העיצוב

| בקוד | מקור | איך |
|------|------|-----|
| `design/tokens.json` | `project/tokens.json` | העתק של קובץ המקור |
| `design/bundle.css` | `project/components/bundle.css` | העתק של קובץ המקור |
| `design/Rubik-VF-hebrew-latin.woff2`, `Rubik-OFL.txt` | `project/fonts/`, `project/licenses/` | העתק |
| `apps/web/src/styles/tokens.css` | `design/tokens.json` | **נוצר** ע"י `node scripts/sync-design.mjs` — לא לערוך ידנית |
| `apps/web/src/styles/global.css` | `design/bundle.css` | מועתק כמו שהוא ע"י אותו סקריפט |
| `packages/shared/src/constants.ts` → `PALETTE` | טוקני `label-*` | חייב להיות זהה; בדיקת יחידה מוודאת ניגודיות AA לכל זוג |
| `apps/web/public/favicon.svg`, `Logo` ב-`Layout.tsx` | `assets/Logos/suboard-mark.svg` | ללא שינוי |
| `apps/web/src/assets/safety-unit-logo.webp` | `assets/Logos/לוגו שקוף (002).png` | הוקטן ל-720px (35KB) |

## ערכות נושא

`data-theme` על `<html>` (`apps/web/src/theme.ts`): `contrast` כשסרגל הנגישות מבקש ניגודיות גבוהה, אחרת `dark` אם מערכת ההפעלה
מעדיפה כהה, אחרת `light`. עד שהסקריפט רץ (הצביעה הראשונה), הקובץ שנוצר כולל גיבוי לפי `prefers-color-scheme` — כדי שלא יהבהב מסך בהיר.

## עדכון אחרי שינוי ב-Design

1. להוריד מהמערכת את `project/tokens.json`, `project/components/bundle.css` ו-`project/fonts/*` אל `design/`.
2. `node scripts/sync-design.mjs`
3. אם השתנו צבעי `label-*` — לעדכן `PALETTE` ולהריץ `npm test`.
4. לבנות, להפעיל מחדש את השרת, ולהריץ בדיקות e2e ובדיקת נגישות (axe).

## חריגה אחת שנשארה

שמות המשתנים `--label-*` לא משמשים ישירות בקוד — צבעי הסטטוס מגיעים מ-`PALETTE` (inline), כי הם מגיעים מנתוני הלוח בזמן ריצה.
לכן שני המקורות חייבים להישאר זהים.
