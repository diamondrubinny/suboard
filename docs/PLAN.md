# SUBoard — מערכת ניהול עבודה ליחידת הבטיחות

> מסמך אפיון ותוכנית עבודה. מקור אמת אחד לתכנון — כל שלב נבנה לפי המסמך הזה.
> סטטוס: **שלב 1 ושלב 2 נבנו ונבדקו** — 65 בדיקות אוטומטיות (8 משותפות + 57 שרת), בדיקות e2e בדפדפן על build פרודקשן, axe: 0 הפרות ב-20 מסכים/מצבים · שלבים 3–4 ממתינים לאישור.

---

## 1. סיכום ההבנה

המשתמש ביקש "מערכת כזאת" על בסיס קובץ `scripts-full.zip`.
**ממצא:** הקובץ הוא לכידת דפדפן של **דף הבית השיווקי של monday.com** — 90 קבצי JS:
סקריפטי מעקב ופרסום (GTM, Meta Pixel, Hotjar, Bing, LinkedIn, Reddit, X, HubSpot, Capterra וכו'),
אנימציות Webflow/GSAP, ו-bundles של ספריות (React, MobX, date-fns). **אין בו לוגיקת מוצר**, ואין
בו דבר שמותר או כדאי להעתיק. לכן נבנתה מערכת **מקורית** בקונספט דומה — *לוחות עבודה גמישים
(Boards)* — מותאמת לתהליכי יחידת בטיחות, בעברית ו-RTL, ובלי שום tracker צד שלישי.

### ערך עסקי
- ריכוז כל תהליכי היחידה (אירועים, סקרים, פעולות מתקנות, הדרכות, בדיקות ציוד, היתרי עבודה) במקום אחד.
- מעקב אחר תאריכי יעד ופריטים באיחור — מניעת "נפילות בין הכיסאות".
- תיעוד ושקיפות: היסטוריית פעולות ועדכונים לכל פריט (חשוב לביקורות ולתחקירים).
- מערכת פנימית, מבוקרת הרשאות, ללא דליפת מידע לצדדים שלישיים.

### הנחות עבודה (ניתן לשנות)
| # | הנחה |
|---|------|
| 1 | ארגון אחד (יחידת בטיחות אחת); 5–50 משתמשים; עד עשרות אלפי פריטים. |
| 2 | מערכת פנימית — אין הרשמה ציבורית; מנהל מערכת יוצר משתמשים. |
| 3 | פריסה on-prem / VM ארגוני מאחורי HTTPS (reverse proxy). |
| 4 | עברית בלבד בשלב 1 (מבנה הקוד מאפשר i18n בהמשך). |
| 5 | העלאת קבצים — **לא** בשלב 1 (דורשת הסגר וסריקת נוזקות — שלב 2). |
| 6 | SQLite בשלב 1; מעבר ל-PostgreSQL מתוכנן כאשר יש צורך ב-HA/עומס. |

### שאלות פתוחות (לא חוסמות)
1. האם נדרשת התחברות SSO ארגונית (Azure AD / Entra ID, SAML)? — משפיע על שלב 2.
2. האם המערכת תכיל מידע רפואי על נפגעים? (ההמלצה: **לא** — רק הפניה למערכת ייעודית.)
3. היכן תותקן (שרת ארגוני / ענן)? מדינת אחסון?
4. האם נדרשות התראות דוא"ל (יעד מתקרב/עבר)? דרך איזה שרת SMTP?
5. האם צריך ייצוא לאקסל / PDF לדוחות הנהלה?

---

## 2. MVP — היקף שלב 1

**בפנים:**
- התחברות אימייל+סיסמה, Session מאובטח, נעילה אחרי ניסיונות כושלים, החלפת סיסמה.
- ניהול משתמשים ותפקידים (מנהל מערכת).
- לוחות (Boards) עם קבוצות (Groups), עמודות (Columns) ופריטים (Items).
- סוגי עמודות: טקסט, טקסט ארוך, מספר, סטטוס (תוויות צבעוניות), אנשים, תאריך, תיבת סימון.
- 7 תבניות מוכנות ליחידת בטיחות (ראו §6).
- תצוגת טבלה (מקובצת) + תצוגת קנבן לפי עמודת סטטוס, חיפוש וסינון.
- חלון פריט: שדות, עדכונים/הערות, היסטוריית פעולות.
- לוח בקרה אישי: הפריטים שלי, באיחור, תמונת מצב לכל לוח.
- הרשאות ברמת לוח (בעלים / עורך / צופה).
- יומן ביקורת (Audit) לאירועי אבטחה.
- עמודי הצהרת נגישות, פרטיות, עוגיות, תנאי שימוש (טיוטות), סרגל נגישות.

**מחוץ לשלב 1:** קבצים מצורפים, התראות דוא"ל, SSO/MFA, ייצוא, תצוגת לוח שנה, טפסי דיווח
ציבוריים, אוטומציות ("כאשר סטטוס = X → ..."), אפליקציית מובייל נייטיב (ה-Web רספונסיבי).

---

## 3. User Stories

| # | כ... | אני רוצה... | כדי ש... |
|---|------|-------------|----------|
| U1 | ממונה בטיחות | לפתוח דיווח על כמעט-אירוע בתוך 30 שניות | שום אירוע לא ילך לאיבוד |
| U2 | ממונה בטיחות | לראות אילו פעולות מתקנות עברו את תאריך היעד | לטפל בהן בעדיפות |
| U3 | ראש היחידה | לראות תמונת מצב של כל הלוחות | לדווח להנהלה |
| U4 | סוקר | לראות את הסקרים שהוקצו לי | לתכנן את השבוע |
| U5 | עובד יחידה | להוסיף עדכון לפריט | שכל הצוות יראה את ההתקדמות |
| U6 | מנהל מערכת | ליצור משתמש, לשנות תפקיד, להשבית | לשלוט בגישה |
| U7 | בעל לוח | להוסיף עמודה/סטטוס חדש | להתאים את הלוח לתהליך |
| U8 | בעל לוח | לתת לגורם חיצוני הרשאת צפייה בלבד | לשתף בלי לאפשר שינויים |
| U9 | מנהל מערכת | לראות ניסיונות התחברות כושלים | לזהות פעילות חשודה |
| U10 | משתמש עם מוגבלות | לעבוד רק עם מקלדת / קורא מסך | להשתמש במערכת באופן שוויוני |

---

## 4. מסכים וזרימות

| מסך | נתיב | הרשאה |
|-----|------|-------|
| התחברות | `/login` | ציבורי |
| לוח בקרה ("שלי") | `/` | מחובר |
| רשימת לוחות + יצירה מתבנית | `/boards` | מחובר (יצירה: admin/manager) |
| לוח — טבלה / קנבן | `/boards/:id` | חבר לוח |
| חלון פריט (מגירה) | `/boards/:id?item=...` | חבר לוח |
| הגדרות לוח (עמודות, קבוצות, חברים) | `/boards/:id/settings` | בעלים |
| ניהול משתמשים | `/admin/users` | admin |
| יומן ביקורת | `/admin/audit` | admin |
| פרופיל / החלפת סיסמה | `/profile` | מחובר |
| הצהרת נגישות / פרטיות / עוגיות / תנאים | `/accessibility` ... | ציבורי |
| 404 | `*` | ציבורי |

**זרימה מרכזית (U1):** לוח "אירועים" → "+ פריט חדש" בקבוצה → הקלדת כותרת → Enter →
עדכון סטטוס/חומרה ישירות בטבלה → פתיחת הפריט → הוספת תיאור ועדכון.

---

## 5. ארכיטקטורה

```
Browser (React SPA, RTL)
   │  HTTPS, cookie session (HttpOnly, Secure, SameSite=Strict)
   ▼
Reverse proxy (nginx / IIS / Caddy) — TLS, HSTS
   ▼
Node.js — Fastify API (TypeScript)
   ├─ plugins: helmet (CSP), rate-limit, cookie, CSRF guard, auth
   ├─ routes  → services (business logic + authorization) → repositories (SQL)
   └─ serves built SPA (static)
   ▼
SQLite (WAL) — קובץ יחיד, גיבוי פשוט  →  (שלב 3: PostgreSQL)
```

### החלטות טכנולוגיות וחלופות
| רכיב | בחירה | למה | חלופות | מגבלות |
|------|-------|-----|--------|--------|
| שפה | TypeScript | טיפוסים משותפים לקליינט/שרת | JS | שלב build |
| API | Fastify 5 | מהיר, plugins רשמיים לאבטחה, `inject` לבדיקות | Express, NestJS | אקוסיסטם קטן מ-Express |
| DB | SQLite (better-sqlite3) | אפס תשתית, טרנזקציות, גיבוי = קובץ | PostgreSQL | כותב יחיד; לא ל-HA |
| ולידציה | Zod (חבילה משותפת) | אותה סכמה בקליינט ובשרת | Valibot, Yup | — |
| Hash סיסמאות | scrypt (Node crypto) | KDF חזק, ללא תלות native | Argon2id | Argon2id עדיף מעט — אפשר להחליף |
| Frontend | React 18 + Vite | סטנדרטי, מהיר | Next.js, Vue | SPA — אין SSR (לא נדרש למערכת פנימית) |
| Data fetching | TanStack Query | cache, optimistic updates | SWR | — |
| עיצוב | CSS משלנו + tokens | שליטה מלאה ב-RTL ובנגישות, bundle קטן | Tailwind, MUI | יותר CSS ידני |

### מבנה תיקיות
```
suboard/
├─ packages/shared/      # Zod schemas, column types, palette (client+server)
├─ apps/server/
│  ├─ src/
│  │  ├─ app.ts          # buildApp(): plugins + routes
│  │  ├─ config.ts       # env validation
│  │  ├─ db/             # connection + migrations
│  │  ├─ lib/            # password, tokens, errors, http helpers
│  │  ├─ plugins/        # auth, csrf
│  │  ├─ services/       # access, auth, users, boards, items, dashboard, audit, templates
│  │  ├─ routes/         # thin HTTP layer
│  │  └─ scripts/        # create-admin, seed-demo
│  └─ test/              # API integration tests (authz / IDOR / validation)
├─ apps/web/src/
│  ├─ api/  auth/  components/  pages/  styles/
└─ docs/                 # PLAN, SECURITY, PRIVACY, PRODUCTION_CHECKLIST, legal drafts
```

---

## 6. תבניות ליחידת בטיחות

| מפתח | שם | עמודות עיקריות |
|------|----|----------------|
| `incidents` | אירועים וכמעט-אירועים | סטטוס, חומרה, סוג אירוע, תאריך, מיקום, אחראי בירור, יעד לסגירה, תיאור |
| `lab_surveys` | סקרי בטיחות במעבדות | מבנה/מעבדה, סוקר, תאריך סקר, סטטוס, ציון, ממצאים, סקר הבא |
| `capa` | פעולות מתקנות ומונעות | אחראי, עדיפות, מקור, סטטוס, תאריך יעד, תיאור |
| `trainings` | הדרכות בטיחות | סוג הדרכה, מדריך, תאריך, משתתפים, סטטוס, הערות |
| `equipment` | בדיקות ציוד תקופתיות | סוג ציוד, מיקום, בדיקה אחרונה, בדיקה הבאה, מצב, אחראי |
| `permits` | היתרי עבודה | סוג היתר, מבצע/קבלן, מאשר, מתאריך, עד תאריך, סטטוס |
| `blank` | לוח ריק | שם פריט, סטטוס, אחראי, תאריך יעד |

כל עמודת סטטוס מגדירה אילו תוויות הן "סגורות" (`done`), וכל לוח מגדיר עמודת תאריך אחת
כ"תאריך יעד" (`role: "due"`) — כך לוח הבקרה מזהה פריטים באיחור באופן אחיד.

---

## 7. סכמת בסיס נתונים

```sql
users(id PK, email UNIQUE, name, password_hash, role[admin|manager|member], is_active,
      must_change_password, failed_logins, locked_until, last_login_at, created_at, updated_at)
sessions(id PK = sha256(token), user_id FK, created_at, expires_at, last_seen_at, user_agent)
boards(id PK, name, description, template_key, created_by FK, created_at, updated_at, archived_at)
board_members(board_id FK, user_id FK, role[owner|editor|viewer], PK(board_id,user_id))
groups(id PK, board_id FK, name, color, position)
columns(id PK, board_id FK, title, type, settings JSON, position)
items(id PK, board_id FK, group_id FK, name, "values" JSON, position, created_by, created_at, updated_at)
updates(id PK, item_id FK, user_id FK, body, created_at)
activity(id PK, board_id FK, item_id, user_id, action, detail JSON, created_at)
audit_log(id PK, user_id, event, ip_hash, meta JSON, created_at)
```
- ערכי עמודות נשמרים ב-`items.values` כ-JSON לפי מזהה עמודה, ועוברים ולידציה בשרת לפי סוג העמודה.
- `ON DELETE CASCADE` מלוח → קבוצות/עמודות/פריטים/עדכונים.
- כתובת IP נשמרת ביומן הביקורת רק כ-HMAC (לא בטקסט גלוי) — מזעור מידע.

---

## 8. API

כל הנתיבים תחת `/api`. כל נתיב פרט ל-`/auth/login` ו-`/health` דורש Session.
כל בקשה משנה מצב (POST/PATCH/PUT/DELETE) דורשת כותרת `X-Requested-With: suboard` ו-Origin תואם.

| Method | Path | הרשאה |
|--------|------|-------|
| GET | `/health` | ציבורי |
| POST | `/auth/login` | ציבורי (rate-limited) |
| POST | `/auth/logout` · GET `/auth/me` · POST `/auth/change-password` | מחובר |
| GET | `/users/directory` | מחובר (id+שם בלבד, לבחירת אחראי) |
| GET/POST | `/users` · PATCH `/users/:id` | admin |
| GET | `/templates` | מחובר |
| GET/POST | `/boards` | מחובר / admin+manager |
| GET/PATCH/DELETE | `/boards/:id` | צופה / בעלים / בעלים |
| PUT/DELETE | `/boards/:id/members[/:userId]` | בעלים |
| POST | `/boards/:id/groups` · PATCH/DELETE `/groups/:id` | עורך |
| POST | `/boards/:id/columns` · PATCH/DELETE `/columns/:id` | בעלים |
| POST | `/boards/:id/items` · PATCH/DELETE `/items/:id` | עורך |
| GET/POST | `/items/:id/updates` · DELETE `/updates/:id` | צופה / עורך / כותב או בעלים |
| GET | `/boards/:id/activity` · `/items/:id/activity` | צופה |
| GET | `/dashboard` | מחובר (רק לוחות שהוא חבר בהם) |
| GET | `/admin/audit` | admin |

**הגנת IDOR/BOLA:** כל נתיב שמקבל מזהה משאב (פריט/עמודה/קבוצה/עדכון) מאתר את ה-`board_id`
של המשאב בשרת ובודק חברות והרשאה *לפני* כל פעולה. מזהים הם UUID אקראיים.

---

## 9. אבטחה — Threat Model (תקציר; פירוט ב-`docs/SECURITY.md`)

| נכס | איום | סיכון | בקרה |
|-----|------|-------|------|
| חשבונות | Brute force / credential stuffing | גבוה | rate-limit ל-IP, נעילת חשבון, הודעת שגיאה גנרית, scrypt |
| Session | גניבת cookie / CSRF | גבוה | HttpOnly+Secure+SameSite=Strict, token אקראי 256bit נשמר כ-hash, כותרת מותאמת+בדיקת Origin, תפוגה מוחלטת+חוסר פעילות |
| נתוני לוחות | IDOR בין לוחות | גבוה | בדיקת הרשאה בשרת לכל משאב, בדיקות אוטומטיות |
| נתונים | XSS | בינוני | React escaping, ללא `dangerouslySetInnerHTML`, CSP קשיח, צבעים מרשימה סגורה |
| נתונים | SQL Injection | בינוני | שאילתות פרמטריות בלבד |
| זמינות | הצפה | בינוני | rate-limit גלובלי, הגבלת payload (100KB) |
| פרטיות | מידע רגיש בטקסט חופשי | בינוני | הנחיה בממשק, מדיניות שמירה, הרשאות לוח |

---

## 10. פרטיות, עוגיות ונגישות

- **Data Map** מלא ב-`docs/PRIVACY.md`.
- **עוגיות:** עוגייה חיונית אחת בלבד (`sb_session`). אין אנליטיקה, אין פיקסלים, אין CDN חיצוני
  לסקריפטים/פונטים → אין צורך בבאנר הסכמה; קיימים עמוד מדיניות עוגיות וקישור "הגדרות פרטיות ועוגיות" ב-Footer.
  אם בעתיד יתווסף כלי מדידה — חובה להוסיף מנגנון הסכמה *לפני* טעינתו.
- **נגישות:** יעד WCAG 2.1 AA / ת"י 5568 — HTML סמנטי, ניווט מקלדת, focus נראה, תוויות,
  `aria-live` להודעות, ניגודיות AA, תמיכת זום 200%, `prefers-reduced-motion`, קנבן עם חלופת מקלדת
  (בחירת סטטוס), סרגל נגישות (הגדלת טקסט, ניגודיות גבוהה, הדגשת קישורים, עצירת אנימציות).

---

## 11. תוכנית שלבים

| שלב | תוכן | סטטוס |
|-----|------|-------|
| **1 — MVP** | כל האמור ב-§2 + בדיקות API + מסמכים | ✅ נבנה |
| **2 — תפעול** | התראות (במערכת + דוא"ל), קבצים מצורפים עם הסגר + ClamAV, MFA (TOTP), ייצוא CSV — פירוט ב-§13 | ✅ נבנה |
| 3 — ארגוני | SSO (Entra ID / SAML), PostgreSQL, גיבוי אוטומטי, ניטור/התראות, תצוגת לוח שנה | ממתין |
| 4 — מתקדם | אוטומציות, טופס דיווח אירוע לכלל העובדים (ללא התחברות / עם SSO), דוחות ומגמות | ממתין |

---

## 12. סיכונים ונושאים לבדיקה מקצועית

- **רגולציה:** דיווח אירועי בטיחות עשוי להיות כפוף לדרישות פקודת הבטיחות בעבודה ותקנות ארגון הפיקוח —
  *דורש בדיקה משפטית/מקצועית* האם המערכת יכולה לשמש כרשומה הרשמית.
- **פרטיות:** מידע על נפגעים (שם, פגיעה) עלול להיות מידע רגיש לפי חוק הגנת הפרטיות (כולל תיקון 13) —
  *דורש בדיקה משפטית / ממונה פרטיות*. המלצה: לא להזין מידע רפואי.
- **SQLite:** כותב יחיד — מספיק ליחידה, לא ל-HA. נקודת מעבר מתוכננת.
- **אבטחה:** לפני פרודקשן — בדיקת חדירות, סקירת תצורת reverse proxy, `npm audit`.
- **נגישות:** בדיקה ידנית עם קורא מסך (NVDA/VoiceOver) על ידי מורשה נגישות.

---

## 13. שלב 2 — תפעול (אפיון)

### הנחות עבודה (השאלות הפתוחות מ-§1 לא נענו — ניתן לשנות)
| # | הנחה | השלכה אם שגויה |
|---|------|----------------|
| A1 | אין SSO בשלב זה | MFA מקומי עשוי להתייתר אם יוטמע SSO עם MFA ארגוני (שלב 3) |
| A2 | יש שרת SMTP ארגוני; אם לא הוגדר — התראות דוא"ל כבויות, התראות במערכת פועלות | אין |
| A3 | ClamAV (clamd) יותקן על השרת או זמין ברשת הפנימית | בלי סורק, קבצים **נשארים בהסגר ולא ניתנים להורדה** (fail-closed) |
| A4 | ייצוא ל-CSV (נפתח באקסל בעברית) מספיק; קובץ xlsx אינו נדרש | xlsx דורש ספרייה נוספת |
| A5 | MFA חובה למנהלי מערכת, רשות לשאר (ניתן להגדרה) | — |

### 13.1 MFA (TOTP)
- RFC 6238 (30 שניות, 6 ספרות, SHA-1 — תאימות לכל אפליקציות האימות). מימוש עם `node:crypto`, ללא ספרייה.
- הסוד מוצפן במנוחה (AES-256-GCM, מפתח `MFA_ENCRYPTION_KEY` מה-env). מניעת שימוש חוזר בקוד (replay) — שמירת ה-time-step האחרון.
- 10 קודי שחזור חד-פעמיים, נשמרים כ-hash בלבד, מוצגים פעם אחת.
- זרימה: סיסמה נכונה → אסימון ביניים (5 דק', עד 5 ניסיונות, נשמר כ-hash) → קוד → Session.
- `MFA_REQUIRED_ROLES=admin`: משתמש בתפקיד כזה ללא MFA מופנה להרשמה (כמו סיסמה זמנית).
- מנהל מערכת יכול לאפס MFA למשתמש (נרשם ביומן). ביטול עצמי דורש סיסמה + קוד.

### 13.2 התראות
- **במערכת:** פעמון עם מונה; התראה כשמשייכים אותך לפריט, ותזכורת יומית על פריטים שלך שבאיחור / ביעד מחר.
- **דוא"ל (אופציונלי):** אותן התראות; ריכוז יומי בשעה מוגדרת (`DIGEST_HOUR`). כל משתמש יכול לכבות דוא"ל בפרופיל.
- תוכן הדוא"ל מינימלי: שם הפריט, הלוח וקישור — ללא תוכן טקסט חופשי (מזעור מידע).
- שמירה: 90 יום, ואז מחיקה אוטומטית.

### 13.3 קבצים מצורפים
- סוגים מותרים: PDF, PNG, JPEG, WEBP, DOCX, XLSX — אימות לפי **חתימת תוכן (magic bytes)** ולא רק סיומת.
- עד 10MB לקובץ, 20 קבצים לפריט, rate-limit להעלאות. שם הקובץ בדיסק = UUID, ללא סיומת, מחוץ ל-web root.
- מצבים: `pending` (הסגר) → `clean` / `infected` / `error`. רק `clean` ניתן להורדה. קובץ נגוע נמחק מהדיסק, נרשם ביומן אבטחה, והמשתמש מקבל הודעה כללית.
- סריקה: פרוטוקול clamd INSTREAM (TCP/Unix socket) ממומש ישירות. אין סורק → fail-closed.
- הורדה: `Content-Disposition: attachment`, `nosniff`, `CSP: sandbox`, הרשאת צופה בלוח.
- הרשאות: עורך מעלה; מוחק — מי שהעלה או בעלי הלוח.
- שיוך אנשים לפריט מוגבל לחברי הלוח (או מנהלי מערכת) — כדי שמי שמקבל התראה אכן יכול לפתוח את הפריט.

### 13.4 ייצוא
- `GET /api/boards/:id/export.csv` (צופה ומעלה): UTF-8 עם BOM (עברית תקינה באקסל), תוויות במקום מזהים, תאריכים DD/MM/YYYY.
- הגנה מפני CSV/Formula injection: תאים שמתחילים ב-`= + - @` טאב או CR מקבלים תחילית `'`.
- נרשם ביומן אבטחה (ייצוא נתונים).

### 13.5 סכמה (מיגרציה 2)
```sql
users += mfa_secret_enc, mfa_enabled, mfa_last_step, email_notifications
mfa_recovery_codes(id, user_id, code_hash, used_at)
mfa_challenges(id=sha256(token), user_id, expires_at, attempts)
notifications(id, user_id, kind, board_id, item_id, title, read_at, emailed_at, created_at)
attachments(id, item_id, board_id, uploaded_by, original_name, mime, size, sha256, status, scanned_at, created_at)
```

### 13.6 API חדש
| Method | Path | הרשאה |
|--------|------|-------|
| POST | `/auth/mfa/verify` | אסימון ביניים |
| POST | `/auth/mfa/setup` · `/auth/mfa/enable` · `/auth/mfa/disable` | מחובר |
| POST | `/users/:id/reset-mfa` | admin |
| GET | `/notifications` · POST `/notifications/read` | מחובר (רק שלו) |
| PATCH | `/auth/preferences` | מחובר |
| GET/POST | `/items/:id/attachments` | צופה / עורך |
| GET | `/attachments/:id/download` · DELETE `/attachments/:id` | צופה / מעלה או בעלים |
| GET | `/boards/:id/export.csv` | צופה |
