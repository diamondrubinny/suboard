# עיצוב — SUBoard Spectrum

מקור האמת לעיצוב הוא מערכת העיצוב **SUBoard Spectrum** ב-claude.ai Design:
https://claude.ai/artifact/ALsm6bLsE2AwqWCd6qvBQh
(גרסה שסונכרנה: `1794303124-1958`, 10/11/2026).

## מה מגיע ממערכת העיצוב

| בקוד | מקור במערכת העיצוב | הערות |
|------|---------------------|-------|
| `apps/web/src/styles/tokens.css` | `project/tokens.css` | כפי שהוא. בסוף הקובץ — תוספות של האפליקציה (ראו למטה) |
| `apps/web/src/styles/global.css` | `project/components/bundle.css` | כפי שהוא, **ללא** שורת ה-`@import` של Google Fonts. אחרי `APP ADDITIONS` — תוספות של האפליקציה |
| `packages/shared/src/constants.ts` → `PALETTE` | טוקני `label-*` | כל זוג רקע/טקסט נבדק בבדיקת יחידה (WCAG AA ≥4.5:1) |
| `apps/web/public/favicon.svg`, `Logo` ב-`Layout.tsx` | `assets/Logos/suboard-mark.svg` | ללא שינוי |
| `apps/web/src/assets/safety-unit-logo.webp` | `assets/Logos/לוגו שקוף (002).png` | הוקטן ל-720px (WebP, 35KB במקום 173KB); מוצג בעמוד ההתחברות |
| גופן Rubik | `type.families.sans` | מוגש מהשרת שלנו דרך `@fontsource/rubik` (OFL-1.1), עברית + לטינית, משקלים 400–700 |

## סטיות מכוונות ממערכת העיצוב — ולמה

1. **הגופן לא נטען מ-Google Fonts.** ה-CSP של המערכת (`font-src 'self'`) חוסם זאת, ומדיניות הפרטיות מתחייבת שאין צדדים שלישיים
   (טעינה מ-Google חושפת את כתובת ה-IP של כל משתמש). הגופן זהה — רק מוגש מקומית.
2. **מצב כהה לפי הגדרת מערכת ההפעלה.** במערכת העיצוב הערכים הכהים מוגדרים רק תחת `[data-theme="dark"]`, אף שה-README שלה
   קובע שהמצב הכהה "follows prefers-color-scheme". הוספנו את אותם ערכים בדיוק תחת `@media (prefers-color-scheme: dark)`.
3. **מצבי סרגל הנגישות** (ניגודיות גבוהה, גופן קריא, הדגשת קישורים, עצירת אנימציות) ו-`prefers-reduced-motion` —
   ה-README של המערכת מתאר אותם אך הגיליון לא כלל אותם. נכתבו מחדש בטוקנים של Spectrum.
4. **משתנים חסרים:** `--font-size` (גודל טקסט מסרגל הנגישות, ברירת מחדל 100%) ו-`--warning-tint` (בשימוש בגיליון
   ולא מוגדר בטוקנים — מופה ל-`tint-sun`).
5. **רכיבי שלב 2** שעוד אינם במערכת העיצוב: פעמון התראות, לשונית קבצים ואזור גרירה, `badge.warning`, כותרת מובייל צרה.
6. **לוגו היחידה במצב כהה** מוצג על משטח לבן (האותיות הכחולות-כהות שלו לא קריאות על רקע כהה). הלוגו עצמו לא שונה.

**מומלץ להעלות את סעיפים 2–5 למערכת העיצוב**, כדי שהיא תחזור להיות מקור אמת מלא.

## סנכרון מחדש אחרי שינוי ב-Design

1. להוריד מהמערכת את `project/tokens.css` ואת `project/components/bundle.css`.
2. `tokens.css` — להחליף את כל מה שמעל `app additions`; `global.css` — להחליף את כל מה שמעל `APP ADDITIONS`,
   ולמחוק את שורת ה-`@import` של Google Fonts.
3. אם השתנו צבעי `label-*` — לעדכן `PALETTE` ולהריץ `npm test` (בדיקת הניגודיות תיכשל אם זוג לא עומד ב-AA).
4. לבדוק שאין בגיליון משתני CSS שאינם מוגדרים, ולהריץ את בדיקות ה-e2e ובדיקת הנגישות (axe).
