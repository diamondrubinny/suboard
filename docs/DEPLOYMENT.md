# פריסה

תצורה מומלצת: VM/שרת ארגוני (Linux), Node.js 22 LTS, reverse proxy עם TLS (nginx / IIS / Caddy),
שירות systemd, גיבוי יומי מוצפן מחוץ לשרת.

## 1. התקנה

```bash
git clone <repo> /opt/suboard
```

```bash
cd /opt/suboard && npm ci && npm run build
```

```bash
cp .env.example .env && chmod 600 .env
```

מלאו `.env`: `APP_ORIGIN` (הכתובת הציבורית), `AUDIT_IP_SECRET`, `TRUST_PROXY_HOPS=1`, `DATABASE_PATH` (מחוץ לתיקיית הקוד, הרשאות 700).

```bash
npm run create-admin -- --email admin@example.org --name "מנהל מערכת"
```

## 1א. ClamAV (חובה לקבצים מצורפים)

```bash
sudo apt-get install -y clamav-daemon clamav-freshclam
```

```bash
sudo systemctl enable --now clamav-freshclam clamav-daemon
```

ב-`/etc/clamav/clamd.conf` ודאו `TCPSocket 3310` ו-`TCPAddr 127.0.0.1` (או השתמשו ב-`CLAMAV_SOCKET` עם ה-Unix socket),
ו-`StreamMaxLength` גדול מ-`MAX_UPLOAD_MB`. בלי סורק פעיל קבצים נשארים בהסגר ואינם ניתנים להורדה (fail-closed),
ונסרקים אוטומטית מחדש כל 5 דקות כשהסורק חוזר.

## 1ב. דוא"ל ו-MFA

- הגדירו `SMTP_HOST` / `SMTP_USER` / `SMTP_PASSWORD` (ב-`.env` בלבד). STARTTLS נדרש; TLS 1.2 ומעלה.
- `MFA_ENCRYPTION_KEY` — מפתח 64 תווים הקסדצימליים. **גבו אותו בנפרד ממסד הנתונים** (למשל בכספת סודות):
  גיבוי DB בלי המפתח לא יאפשר אימות MFA, וזליגת DB בלי המפתח לא חושפת את סודות ה-TOTP.
- ייתכן שיש להוסיף את `ReadWritePaths` גם לתיקיית `UPLOAD_DIR` ב-systemd.

## 1ג. משימות מתוזמנות (גל B)

השרת מריץ בעצמו, כל 5 דקות, את המשימות הבאות — אין צורך ב-cron חיצוני:

| משימה | מתי | הערה |
|-------|-----|------|
| פריטים חוזרים | ברגע שהגיע תאריך המופע | מופע שפוספס (שרת כבוי) — נוצר פריט אחד בלבד |
| חוקים מתוזמנים (תאריך / SLA) | פעם ביום אחרי `DIGEST_HOUR` | חוק "N ימים לפני/אחרי" ממשיך לפעול עד 7 ימים באיחור אם השרת היה כבוי |
| דוחות מתוזמנים | פעם ביום אחרי `DIGEST_HOUR` | לכל דוח לכל היותר פעם ביום |
| תזכורות יומיות | פעם ביום אחרי `DIGEST_HOUR` | |

הרצה של **יותר ממופע שרת אחד** על אותו מסד נתונים: פריטים חוזרים ודוחות נתפסים ב-UPDATE מותנה ולכן לא יוכפלו, אך מומלץ מופע יחיד (SQLite).
יומן הרצות האוטומציה נמחק אחרי 90 יום (תחזוקה שעתית).

## 1ד. אפליקציה בנייד (PWA), QR ומצלמה (גל C)

- **HTTPS חובה**: Service Worker, התקנה כאפליקציה ופתיחת המצלמה בטופס עובדים רק ב-HTTPS (או localhost).
- מדבקות QR מקודדות את הכתובת שממנה הודפסו (`https://<הכתובת בדפדפן>/q/<מזהה>`). **הדפיסו מהכתובת הרשמית והקבועה של המערכת**; אם הכתובת תשתנה — יש להדפיס מחדש.
- הכתובת צריכה להיות נגישה מהטלפון (Wi-Fi ארגוני / VPN). מחוץ לרשת — הסריקה תציג "אין חיבור".
- `sw.js` מוגש עם `Cache-Control: no-cache` (כבר מוגדר); אחרי פריסה הדפדפנים יקבלו את הגרסה החדשה בטעינה הבאה.

## 1ה. התחברות ארגונית (SSO) וסנכרון משתמשים (SCIM) — Microsoft Entra ID

> עד שהשלבים האלה הושלמו, **ההתחברות הרגילה בסיסמה נשארת פעילה** (`LOCAL_LOGIN=enabled`). שמות התפריטים ב-Entra משתנים מעת לעת — **דורש אימות מול התיעוד הרשמי של Microsoft**.

**א. רישום אפליקציה (SSO)**

1. Entra admin center ← App registrations ← New registration: שם `SUBoard`, חשבונות בארגון בלבד (Single tenant).
2. Redirect URI מסוג **Web**: `https://<הכתובת>/api/auth/sso/callback` (בדיוק כמו `PUBLIC_URL` + הנתיב).
3. Certificates & secrets ← New client secret ← העתיקו את הערך ל-`OIDC_CLIENT_SECRET` (בכספת הסודות; לחדש לפני פקיעה).
4. `OIDC_CLIENT_ID` = Application (client) ID; `OIDC_ISSUER` = `https://login.microsoftonline.com/<Directory (tenant) ID>/v2.0`.
5. Token configuration ← Add optional claim (ID) ← `email` (אחרת המערכת משתמשת ב-`preferred_username`).
6. **MFA:** הגדירו Conditional Access שמחייב MFA לאפליקציה, ואז `SSO_TRUST_IDP_MFA=true`. בלי זה, המערכת מסתמכת על הטענה `amr` בטוקן — ייתכן שאינה נשלחת בטוקן v2 (**לבדיקה**) — ומנהלי מערכת יידרשו להגדיר גם TOTP מקומי.
7. מומלץ: Enterprise applications ← SUBoard ← Properties ← **Assignment required = Yes**, והקצאת קבוצת היחידה בלבד.
8. אתחול השרת, ובעמוד הכניסה מופיע כפתור "התחברות ארגונית". **קודם לבדוק כניסה של מנהל מערכת ב-SSO**, ורק אז לשקול `LOCAL_LOGIN=admins_only` (חשבון חירום) — לא `disabled`, כדי שתקלה אצל ספק הזהות לא תנעל את כולם בחוץ.

**ב. סנכרון משתמשים (SCIM)**

1. צרו אסימון אקראי: `openssl rand -base64 48` ← `SCIM_TOKEN`, ואתחלו.
2. Enterprise applications ← SUBoard ← Provisioning ← Automatic: Tenant URL `https://<הכתובת>/scim/v2`, Secret Token = הערך ← Test Connection.
3. מיפוי מאפיינים (Users): `userPrincipalName → userName`, `displayName → displayName`, `mail → emails[type eq "work"].value`, `objectId → externalId`, `Switch([IsSoftDeleted], …) → active` (ברירת המחדל של Entra). **Groups — כבו** (לא נתמך בשלב זה).
4. Scope: Sync only assigned users and groups ← Start provisioning.
5. התוצאה: משתמש שהוקצה נוצר כ"משתמש" (member) בלי סיסמה ונכנס ב-SSO; הסרה / השבתה ב-Entra ← **השבתה** במערכת וניתוק מיידי של כל החיבורים. תפקידים (manager / admin) — נקבעים במערכת ע"י מנהל מערכת.
6. SCIM לא ישבית לעולם את מנהל המערכת הפעיל האחרון.

**נבדק** מול ספק OIDC מדומה (HTTPS, חתימת RS256, PKCE) ומול צורת הבקשות של Entra ל-SCIM (PATCH עם `Replace` ו-`"False"`). **לא נבדק מול Entra ID אמיתי** — יש לבצע בדיקת קבלה בסביבת הארגון.

## 1ו. התקנה בתיקייה של אתר קיים (למשל `https://dreadlist.com/test`)

המערכת יכולה לרוץ תחת תיקייה של דומיין קיים, לצד האתר שכבר רץ בו. הכתובת נקבעת ב-`PUBLIC_URL` (כולל התיקייה), והממשק נבנה עם `VITE_BASE_PATH` זהה. עוגיית החיבור מוגבלת לתיקייה, כך שהאתר הקיים לא מקבל אותה.

**שרת Linux (Ubuntu 22.04/24.04, Debian 12) עם nginx או Apache — סקריפט אחד:**

```bash
curl -fsSLO https://raw.githubusercontent.com/diamondrubinny/suboard/claude/nifty-ptolemy-dn445c/deploy/install-subfolder.sh
```

```bash
sudo bash install-subfolder.sh https://dreadlist.com/test admin@dreadlist.com
```

(אם המאגר פרטי — העתיקו את הקובץ `deploy/install-subfolder.sh` לשרת בדרך אחרת, והגדירו גישת קריאה ל-git, למשל deploy key.)

הסקריפט: מתקין Node.js 22, ClamAV ו-git; יוצר משתמש מערכת `suboard`; מוריד ובונה את הקוד ל-`/opt/suboard` עבור התיקייה; כותב `.env` עם סודות שנוצרים בשרת (פעם אחת, לא נדרס); יוצר שירות systemd שמאזין ל-`127.0.0.1:3000` בלבד; יוצר מנהל מערכת עם סיסמה חד-פעמית שמודפסת פעם אחת. **הוא לא משנה את הגדרות שרת האינטרנט הקיים** — הוא כותב קטע מוכן ל-nginx (`/etc/suboard/nginx-location.conf`) ול-Apache (`/etc/suboard/apache-location.conf`), ואתם מוסיפים שורת `include` אחת בבלוק ה-HTTPS של האתר וטוענים מחדש. עדכון גרסה: הרצה חוזרת של אותו סקריפט.

- **אתר בדיקות:** `NOINDEX=true` (ברירת המחדל בסקריפט) מוסיף `X-Robots-Tag: noindex` לכל תשובה. **רק נתונים בדויים** באתר בדיקות שחשוף לאינטרנט.
- `APP_ORIGIN` הוא המקור בלבד (`https://dreadlist.com`, בלי תיקייה) — הוא נבדק מול כותרת `Origin` של הדפדפן.
- **אחסון משותף (cPanel / Plesk):** אפשרי רק אם יש "Setup Node.js App"; יש לבנות עם `VITE_BASE_PATH=/test/` ולהגדיר את אותם משתנים. ללא תמיכה ב-Node.js — לא ניתן להריץ את המערכת שם.
- **IIS (Windows):** URL Rewrite + ARR, כלל reverse proxy מ-`test/(.*)` ל-`http://127.0.0.1:3000/test/{R:1}`, ושירות Windows ל-Node (למשל NSSM).

## 2. systemd (`/etc/systemd/system/suboard.service`)

```ini
[Unit]
Description=SUBoard
After=network.target

[Service]
Type=simple
User=suboard
WorkingDirectory=/opt/suboard/apps/server
ExecStart=/usr/bin/node --env-file=/opt/suboard/.env dist/index.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/var/lib/suboard /var/lib/suboard/uploads
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

השרת מאזין ל-`127.0.0.1:3000` בלבד; רק ה-proxy חשוף.

## 3. nginx (דוגמה)

```nginx
server {
  listen 443 ssl http2;
  server_name safety.example.org;
  ssl_certificate     /etc/ssl/certs/safety.crt;
  ssl_certificate_key /etc/ssl/private/safety.key;
  ssl_protocols TLSv1.2 TLSv1.3;
  client_max_body_size 12m;   # MAX_UPLOAD_MB + overhead

  limit_req_zone $binary_remote_addr zone=suboard:10m rate=20r/s;  # (בבלוק http)
  location / {
    limit_req zone=suboard burst=40 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
server { listen 80; server_name safety.example.org; return 301 https://$host$request_uri; }
```

## 4. גיבוי (cron יומי)

```bash
15 2 * * * cd /opt/suboard/apps/server && /usr/bin/node --env-file=/opt/suboard/.env dist/scripts/backup.js --out /var/backups/suboard --keep 14
```

גבו גם את תיקיית `UPLOAD_DIR/store` (קבצים מצורפים שנסרקו). העתיקו את תיקיית הגיבוי מוצפנת לאחסון חיצוני, ובדקו **שחזור** אחת לרבעון (עצירת שירות → החלפת קובץ ה-DB → הפעלה).

## 5. עדכון גרסה

```bash
git pull && npm ci && npm run build && npm test && sudo systemctl restart suboard
```

מיגרציות מסד הנתונים רצות אוטומטית בעליית השרת. גבו לפני כל עדכון.

## 6. מנהל שננעל מחוץ ל-MFA (Break-glass)

אם מנהל איבד גם את מכשיר האימות וגם את קודי השחזור, ואין מנהל נוסף שיכול לאפס — מתוך השרת:

```bash
cd /opt/suboard/apps/server && node --env-file=/opt/suboard/.env dist/scripts/create-admin.js --email admin@example.org --reset-mfa
```

הפעולה מנתקת את כל החיבורים של המשתמש ונרשמת ביומן האבטחה (`mfa_reset`, `via: cli`). יש לאמת את זהות המבקש לפני ביצוע.
