# אבטחה — SUBoard

> מסמך זה מתאר את הבקרות הקיימות בקוד. **אינו** הצהרה על אבטחה מוחלטת — נדרשת בדיקת חדירות לפני פרודקשן.

## Threat Model

| נכס | שחקן איום | איום | בקרות קיימות | סיכון שיורי |
|-----|-----------|------|--------------|-------------|
| חשבונות משתמשים | תוקף חיצוני ברשת הארגון | Brute force / credential stuffing | rate-limit להתחברות לפי IP (10/15 דק'), נעילת חשבון (5 כשלונות → 15 דק'), scrypt, הודעת שגיאה גנרית, השוואת זמנים לחשבון לא קיים, יומן אבטחה | בינוני — אין MFA (שלב 2) |
| Session | XSS / רשת | גניבת cookie, fixation | `HttpOnly`, `Secure`, `SameSite=Strict`, token אקראי 256 bit שנשמר רק כ-SHA-256, token חדש בכל התחברות, תפוגה מוחלטת (12ש') ותפוגת חוסר פעילות (2ש'), ביטול כל הסשנים בהחלפת/איפוס סיסמה והשבתת משתמש | נמוך |
| פעולות משנות מצב | אתר זדוני | CSRF | SameSite=Strict + כותרת חובה `X-Requested-With` (מחייבת preflight שה-API לעולם לא מאשר) + בדיקת `Origin` מול allow-list | נמוך |
| נתוני לוחות | משתמש מחובר | IDOR / BOLA | כל נתיב מאתר בשרת את הלוח של המשאב (`AccessService`) ובודק הרשאה; משתמש ללא גישה מקבל 404 (לא חושף קיום); בדיקות אוטומטיות לכל סוגי המשאבים | נמוך |
| נתוני לוחות | משתמש מחובר | הסלמת הרשאות | תפקיד נקרא מה-DB בכל בקשה; מנהל לא יכול להשבית/להוריד את עצמו; תמיד נשאר admin פעיל ובעלים ללוח | נמוך |
| ממשק | תוקף ששותל תוכן | XSS מאוחסן | React מקודד פלט; אין `dangerouslySetInnerHTML`; CSP קשיח (`script-src 'self'`, ללא inline); צבעים מרשימה סגורה בלבד | נמוך |
| DB | קלט זדוני | SQL injection | שאילתות פרמטריות בלבד; שמות עמודות ב-UPDATE מגיעים מרשימה קבועה; מזהים עוברים ולידציית UUID לפני גישה ל-DB | נמוך |
| זמינות | משתמש/תוקף | DoS | rate-limit גלובלי (600/דק' ל-IP), `bodyLimit` 100KB, הגבלות אורך/כמות בכל סכמה | בינוני — נדרש גם rate-limit ב-proxy |
| Clickjacking | אתר זדוני | מסגור | `frame-ancestors 'none'`, `X-Frame-Options` | נמוך |
| לוגים | מי שיש לו גישה ללוגים | דליפת סודות | redaction של cookie/authorization/set-cookie; אין רישום גוף בקשות; IP ביומן הביקורת כ-HMAC | נמוך |

## כותרות HTTP

`Content-Security-Policy` (ללא unsafe-inline), `Strict-Transport-Security` (כש-Secure), `X-Content-Type-Options: nosniff`,
`Referrer-Policy: same-origin`, `Permissions-Policy` (מצלמה/מיקרופון/מיקום/תשלום חסומים),
`Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Cache-Control: no-store` לכל ה-API.

## Endpoints — ציבורי מול מוגן

- **ציבוריים:** `GET /api/health`, `POST /api/auth/login`.
- **כל השאר** דורשים Session. נתיבים תחת `/api/users` (פרט ל-`/directory`) ו-`/api/admin/*` — admin בלבד.
- בזמן "סיסמה זמנית" רק `/auth/me`, `/auth/change-password`, `/auth/logout` זמינים.
- `/api/users/directory` מחזיר רק `id` ו-`name` (ללא דוא"ל) — לבחירת אחראים.

## סודות

- אין סודות בקוד. `AUDIT_IP_SECRET` חובה ב-production (≥32 תווים), נטען ממשתני סביבה בלבד.
- סיסמת מנהל ראשונית נקלטת אינטראקטיבית (לא ב-argv / היסטוריית shell).
- סיסמאות זמניות נוצרות בדפדפן ב-`crypto.getRandomValues` ומוצגות פעם אחת.

## קבצים מצורפים

לא קיימים בשלב 1 במכוון. בשלב 2: allow-list לסוגים, אימות MIME, שינוי שם, אחסון מחוץ ל-web root,
הסגר (quarantine) עד סריקת ClamAV, חסימה ותיעוד בכשל — ראו `PLAN.md` §11.

## תלויות

- `npm audit` נקי בזמן הבנייה (0 חולשות ידועות). בוצע שדרוג מ-zod 3 / react-router 6 / vitest 3 שהיו פגיעים.
- להריץ `npm run audit:deps` לפני כל פריסה; מומלץ Dependabot/Renovate ו-SBOM (`npm sbom --sbom-format cyclonedx`).

## דיווח על חולשה

פנו ל[גורם האבטחה בארגון — להשלמה]. אין לבדוק חולשות על סביבת הייצור ללא אישור.
