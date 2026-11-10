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
