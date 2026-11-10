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
ReadWritePaths=/var/lib/suboard
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
  client_max_body_size 200k;

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

העתיקו את תיקיית הגיבוי מוצפנת לאחסון חיצוני, ובדקו **שחזור** אחת לרבעון (עצירת שירות → החלפת קובץ ה-DB → הפעלה).

## 5. עדכון גרסה

```bash
git pull && npm ci && npm run build && npm test && sudo systemctl restart suboard
```

מיגרציות מסד הנתונים רצות אוטומטית בעליית השרת. גבו לפני כל עדכון.
