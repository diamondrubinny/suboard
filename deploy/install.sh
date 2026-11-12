#!/usr/bin/env bash
# SUBoard — production installer for an existing Linux web server (Ubuntu 22.04/24.04, Debian 12).
# Run as root (sudo). Works for a dedicated (sub)domain or for a folder of an existing site:
#
#   sudo bash install.sh https://suboard.example.org      admin@example.org     # dedicated address
#   sudo bash install.sh https://www.example.org/safety   admin@example.org     # folder of a site
#
# What it does (idempotent; re-run to update — the database is backed up first):
#   - Node.js 22 LTS (NodeSource apt repo), git, ClamAV (malware scanning of uploads), build tools
#   - system user "suboard"; code in /opt/suboard; data (DB + uploads + backups) in /var/lib/suboard (700)
#   - builds the web app for the address and writes /opt/suboard/.env (600) with generated secrets —
#     only on the first run, never overwritten
#   - systemd service listening on 127.0.0.1 only (never exposed directly)
#   - daily local database backup (14 kept) in /var/lib/suboard/backups — copy them off the server yourself
#   - first administrator with a random one-time password, printed once
#   - reverse proxy: adds ONE include line to the HTTPS block of this domain in nginx / Apache (backup
#     kept, config tested, rolled back on failure). A dedicated address with no site yet gets its own
#     nginx site; HTTPS for it comes from certbot (SUBOARD_CERTBOT=1 runs it for you).
#
# Options (environment): SUBOARD_PORT=3000  SUBOARD_REF=main (branch or tag, e.g. v1.0.0)
#                        SUBOARD_WIRE=0 (do not touch the web server)  SUBOARD_CERTBOT=1
set -euo pipefail

PUBLIC_URL="${1:-}"
ADMIN_EMAIL="${2:-}"
REPO="${SUBOARD_REPO:-https://github.com/diamondrubinny/suboard.git}"
BRANCH="${SUBOARD_REF:-${SUBOARD_BRANCH:-main}}"
PORT="${SUBOARD_PORT:-3000}"
APP_DIR=/opt/suboard
DATA_DIR=/var/lib/suboard

die() { echo "ERROR: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "run as root: sudo bash $0 <public-url> <admin-email>"
[[ "$PUBLIC_URL" =~ ^https://[A-Za-z0-9.-]+(/[A-Za-z0-9._~-]+)*/?$ ]] || die "first argument: the public https address, e.g. https://suboard.example.org or https://www.example.org/safety"
[[ "$ADMIN_EMAIL" =~ ^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$ ]] || die "second argument: administrator e-mail"
PUBLIC_URL="${PUBLIC_URL%/}"
ORIGIN="$(echo "$PUBLIC_URL" | sed -E 's#^(https://[^/]+).*#\1#')"
BASE_PATH="${PUBLIC_URL#"$ORIGIN"}"          # e.g. /safety, or empty for a dedicated address
HOST="${ORIGIN#https://}"
command -v apt-get >/dev/null || die "this script supports Ubuntu / Debian (apt)"

port_owner() { ss -ltnpH "( sport = :$1 )" 2>/dev/null | sed -n 's/.*users:(("\([^"]*\)".*/\1/p' | head -1; }
if [ -n "$(port_owner "$PORT")" ] && ! systemctl is-active --quiet suboard 2>/dev/null; then
  die "port $PORT is already used by '$(port_owner "$PORT")' (another application). Re-run with a free port, e.g.:  sudo SUBOARD_PORT=3100 bash $0 $PUBLIC_URL $ADMIN_EMAIL"
fi

echo "==> Packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl gnupg git build-essential python3 openssl clamav-daemon clamav-freshclam
if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 22 ]; then
  install -d -m 0755 /etc/apt/keyrings
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor --yes -o /etc/apt/keyrings/nodesource.gpg
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main" > /etc/apt/sources.list.d/nodesource.list
  apt-get update -y && apt-get install -y nodejs
fi
echo "node $(node --version)"

echo "==> ClamAV"
CLAMD_CONF=/etc/clamav/clamd.conf
grep -q '^TCPSocket' "$CLAMD_CONF" || echo 'TCPSocket 3310' >> "$CLAMD_CONF"
grep -q '^TCPAddr' "$CLAMD_CONF" || echo 'TCPAddr 127.0.0.1' >> "$CLAMD_CONF"
sed -i 's/^StreamMaxLength .*/StreamMaxLength 25M/' "$CLAMD_CONF"; grep -q '^StreamMaxLength' "$CLAMD_CONF" || echo 'StreamMaxLength 25M' >> "$CLAMD_CONF"
systemctl enable --now clamav-freshclam || true
systemctl enable clamav-daemon && systemctl restart clamav-daemon || echo "WARN: clamav-daemon not running yet (signatures still downloading?) — uploads stay quarantined until it is"

echo "==> User and folders"
id suboard >/dev/null 2>&1 || useradd --system --home "$DATA_DIR" --shell /usr/sbin/nologin suboard
install -d -m 0700 -o suboard -g suboard "$DATA_DIR" "$DATA_DIR/uploads"

echo "==> Code ($BRANCH)"
if [ -d "$APP_DIR/.git" ]; then
  # Update: keep a copy of the database as it is before the new version migrates it.
  if [ -f "$DATA_DIR/suboard.db" ] && [ -f "$APP_DIR/apps/server/dist/scripts/backup.js" ]; then
    runuser -u suboard -- env HOME="$DATA_DIR" bash -c "cd '$APP_DIR/apps/server' && node --env-file='$APP_DIR/.env' dist/scripts/backup.js --out '$DATA_DIR/backups' --keep 14" \
      || die "could not back up the database before updating — nothing was changed"
  fi
  git -C "$APP_DIR" fetch --depth 1 origin "$BRANCH" && git -C "$APP_DIR" checkout --detach FETCH_HEAD
else
  git clone --depth 1 -b "$BRANCH" "$REPO" "$APP_DIR"
fi
chown -R suboard:suboard "$APP_DIR"

echo "==> Configuration"
ENV_FILE="$APP_DIR/.env"
if [ ! -f "$ENV_FILE" ]; then
  umask 077
  cat > "$ENV_FILE" <<EOF
NODE_ENV=production
HOST=127.0.0.1
PORT=$PORT
APP_ORIGIN=$ORIGIN
PUBLIC_URL=$PUBLIC_URL
TRUST_PROXY_HOPS=1
DATABASE_PATH=$DATA_DIR/suboard.db
UPLOAD_DIR=$DATA_DIR/uploads
STATIC_DIR=$APP_DIR/apps/web/dist
AUDIT_IP_SECRET=$(openssl rand -hex 32)
MFA_ENCRYPTION_KEY=$(openssl rand -hex 32)
MFA_REQUIRED_ROLES=admin
CLAMAV_HOST=127.0.0.1
CLAMAV_PORT=3310
TIME_ZONE=Asia/Jerusalem
LOCAL_LOGIN=enabled
# An internal system behind sign-in: keep it out of search engines.
NOINDEX=true
# E-mail (notifications + "forgot password"). Fill in and restart: systemctl restart suboard
# SMTP_HOST=smtp.example.com
# SMTP_PORT=587
# SMTP_USER=
# SMTP_PASSWORD=
# MAIL_FROM=SUBoard <noreply@$HOST>
EOF
  chown suboard:suboard "$ENV_FILE"; chmod 600 "$ENV_FILE"
  echo "wrote $ENV_FILE (secrets generated here; back up MFA_ENCRYPTION_KEY separately from the DB)"
else
  echo "keeping existing $ENV_FILE (secrets unchanged); updating address and port"
  set_env() { if grep -q "^$1=" "$ENV_FILE"; then sed -i "s#^$1=.*#$1=$2#" "$ENV_FILE"; else echo "$1=$2" >> "$ENV_FILE"; fi; }
  set_env PORT "$PORT"; set_env APP_ORIGIN "$ORIGIN"; set_env PUBLIC_URL "$PUBLIC_URL"; set_env STATIC_DIR "$APP_DIR/apps/web/dist"
fi

echo "==> Build (${BASE_PATH:-/})"
runuser -u suboard -- env HOME="$DATA_DIR" bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund && VITE_BASE_PATH='$BASE_PATH/' npm run build"

echo "==> Service"
cat > /etc/systemd/system/suboard.service <<EOF
[Unit]
Description=SUBoard
After=network.target clamav-daemon.service

[Service]
Type=simple
User=suboard
WorkingDirectory=$APP_DIR/apps/server
ExecStart=/usr/bin/node --env-file=$ENV_FILE dist/index.js
Restart=on-failure
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$DATA_DIR
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable suboard
systemctl restart suboard
for i in $(seq 1 30); do curl -fs "http://127.0.0.1:$PORT/api/health" >/dev/null && break; sleep 1; done
# Make sure it is SUBoard that answers, under the folder (not another app on the same port).
curl -fs "http://127.0.0.1:$PORT$BASE_PATH/api/auth/sso/config" | grep -q '"localLogin"' \
  || die "SUBoard is not answering on 127.0.0.1:$PORT$BASE_PATH — see: journalctl -u suboard -n 50 --no-pager"
curl -fs "http://127.0.0.1:$PORT$BASE_PATH/" | grep -q "$BASE_PATH/assets/" \
  || die "the web app was not built for $BASE_PATH — re-run this script"

echo "==> Daily backup"
cat > /etc/cron.d/suboard-backup <<EOF
# SUBoard: daily local database backup, 14 kept. Copy $DATA_DIR/backups (encrypted) off this server.
17 2 * * * suboard cd $APP_DIR/apps/server && /usr/bin/node --env-file=$ENV_FILE dist/scripts/backup.js --out $DATA_DIR/backups --keep 14 >/dev/null
EOF
chmod 644 /etc/cron.d/suboard-backup

echo "==> Administrator"
ADMIN_PW=""
if [ ! -f "$DATA_DIR/.admin-created" ]; then
  ADMIN_PW="$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)Aa1!"
  printf '%s\n' "$ADMIN_PW" | runuser -u suboard -- env HOME="$DATA_DIR" bash -c "cd '$APP_DIR/apps/server' && npx tsx --env-file='$ENV_FILE' src/scripts/create-admin.ts --email '$ADMIN_EMAIL' --name 'מנהל מערכת'"
  touch "$DATA_DIR/.admin-created"; chown suboard:suboard "$DATA_DIR/.admin-created"
fi

echo "==> Reverse proxy snippets (not applied — include one in your site's config)"
install -d /etc/suboard
PROXY_NGINX="    client_max_body_size 12m;
    proxy_pass http://127.0.0.1:$PORT;
    proxy_http_version 1.1;
    proxy_set_header Host \$host;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto \$scheme;"
if [ -n "$BASE_PATH" ]; then
cat > /etc/suboard/nginx-location.conf <<EOF
# Include inside the existing  server { listen 443 ssl; server_name $HOST; ... }  block:
#   include /etc/suboard/nginx-location.conf;
location = $BASE_PATH { return 301 $BASE_PATH/; }
# ^~ : regex locations of the existing site (e.g. caching *.js / *.css, PHP) must not take these requests.
location ^~ $BASE_PATH/ {
$PROXY_NGINX
}
EOF
cat > /etc/suboard/apache-location.conf <<EOF
# Inside the existing <VirtualHost *:443> for $HOST (needs: a2enmod proxy proxy_http headers):
#   Include /etc/suboard/apache-location.conf
RedirectMatch 301 ^$BASE_PATH\$ $BASE_PATH/
ProxyPreserveHost On
ProxyPass        $BASE_PATH/ http://127.0.0.1:$PORT$BASE_PATH/
ProxyPassReverse $BASE_PATH/ http://127.0.0.1:$PORT$BASE_PATH/
RequestHeader set X-Forwarded-Proto "https"
LimitRequestBody 12582912
EOF
else
cat > /etc/suboard/nginx-location.conf <<EOF
# Dedicated address: the whole site is SUBoard. Include inside  server { listen 443 ssl; server_name $HOST; ... }
# (remove any other "location /" from that block):
#   include /etc/suboard/nginx-location.conf;
location ^~ / {
$PROXY_NGINX
}
EOF
cat > /etc/suboard/apache-location.conf <<EOF
# Inside the <VirtualHost *:443> for $HOST (needs: a2enmod proxy proxy_http headers):
#   Include /etc/suboard/apache-location.conf
ProxyPreserveHost On
ProxyPass        / http://127.0.0.1:$PORT/
ProxyPassReverse / http://127.0.0.1:$PORT/
RequestHeader set X-Forwarded-Proto "https"
LimitRequestBody 12582912
EOF
fi

# ---- Connect to the existing web server automatically (SUBOARD_WIRE=0 to skip).
# Edits only the HTTPS server block of this domain: a backup is kept, the config is tested, and the
# change is rolled back if the test fails.
WIRED=""
NEED_CERT=""
wire() { # $1 = nginx|apache
  python3 - "$1" "$HOST" <<'PY'
import glob, os, re, sys, time
kind, host = sys.argv[1], sys.argv[2]
if kind == 'nginx':
    files = glob.glob('/etc/nginx/sites-enabled/*') + glob.glob('/etc/nginx/conf.d/*.conf')
    line = '    include /etc/suboard/nginx-location.conf;  # SUBoard'
else:
    files = glob.glob('/etc/apache2/sites-enabled/*.conf')
    line = '    Include /etc/suboard/apache-location.conf  # SUBoard'
host_re = re.compile(r'(server_name|ServerName|ServerAlias)\s[^;\n]*(?<![\w.-])' + re.escape(host) + r'(?![\w.-])')
done = []
for f in sorted({os.path.realpath(x) for x in files if os.path.isfile(x)}):
    text = open(f).read()
    if '/etc/suboard/' in text:
        print('already:' + f); sys.exit(0)
    lines = text.split('\n')
    out, i, changed = [], 0, False
    if kind == 'nginx':
        # brace-matched "server { ... }" blocks
        depth, start = 0, None
        blocks = []
        for n, l in enumerate(lines):
            code = l.split('#', 1)[0]
            if start is None and re.match(r'\s*server\s*\{', code) and depth == 0:
                start = n
            depth += code.count('{') - code.count('}')
            if start is not None and depth == 0:
                blocks.append((start, n)); start = None
        for a, b in reversed(blocks):
            body = '\n'.join(lines[a:b + 1])
            if re.search(r'listen\s+[^;]*443', body) and host_re.search(body):
                lines.insert(b, line); changed = True
                break
    else:
        start = None
        for n, l in enumerate(lines):
            if re.match(r'\s*<VirtualHost\s+[^>]*:443\s*>', l): start = n
            if start is not None and re.match(r'\s*</VirtualHost>', l):
                body = '\n'.join(lines[start:n])
                if host_re.search(body):
                    lines.insert(n, line); changed = True
                    break
                start = None
    if changed:
        # Backups outside the web server's include folders (a copy in sites-enabled would be loaded).
        os.makedirs('/etc/suboard/backups', exist_ok=True)
        bak = '/etc/suboard/backups/' + os.path.basename(f) + '.' + time.strftime('%Y%m%d%H%M%S')
        open(bak, 'w').write(text)
        open(f, 'w').write('\n'.join(lines))
        print('wired:' + f + '|' + bak); sys.exit(0)
print('notfound:'); sys.exit(0)
PY
}
if [ "${SUBOARD_WIRE:-1}" = "1" ]; then
  if command -v nginx >/dev/null && systemctl is-active --quiet nginx; then
    R="$(wire nginx)"
    case "$R" in
      wired:*) F="${R#wired:}"; FILE="${F%%|*}"; BAK="${F#*|}"
        if nginx -t 2>/dev/null; then systemctl reload nginx; WIRED="nginx ($FILE; backup $BAK)"
        else cp "$BAK" "$FILE"; echo "WARN: nginx test failed — change rolled back ($FILE)"; fi ;;
      already:*) systemctl reload nginx; WIRED="nginx (already connected)" ;;
      *) if [ -z "$BASE_PATH" ] && ! grep -rqsE "server_name[^;]*[[:space:]]$HOST([[:space:];])" /etc/nginx/sites-enabled /etc/nginx/conf.d; then
           # A dedicated address with no site yet: give it its own nginx site (plain HTTP until a certificate is issued).
           SITE=/etc/nginx/conf.d/suboard-$HOST.conf
           if [ -d /etc/nginx/sites-available ]; then SITE=/etc/nginx/sites-available/suboard-$HOST.conf; fi
           printf 'server {\n    listen 80;\n    listen [::]:80;\n    server_name %s;\n    include /etc/suboard/nginx-location.conf;  # SUBoard\n}\n' "$HOST" > "$SITE"
           if [ -d /etc/nginx/sites-enabled ]; then ln -sf "$SITE" "/etc/nginx/sites-enabled/suboard-$HOST.conf"; fi
           if nginx -t 2>/dev/null; then
             systemctl reload nginx; echo "created nginx site $SITE (HTTP only so far)"
             if [ "${SUBOARD_CERTBOT:-0}" = "1" ] && command -v certbot >/dev/null; then
               if certbot --nginx -d "$HOST" --non-interactive --agree-tos -m "$ADMIN_EMAIL" --redirect; then WIRED="nginx ($SITE, certificate from Let's Encrypt)"; else NEED_CERT=1; fi
             else
               NEED_CERT=1
             fi
           else
             rm -f "$SITE" "/etc/nginx/sites-enabled/suboard-$HOST.conf"; echo "WARN: nginx test failed — the new site was removed"
           fi
         else
           echo "WARN: no HTTPS server block for $HOST found in /etc/nginx — connect it by hand (below)"
         fi ;;
    esac
  elif command -v apache2ctl >/dev/null && systemctl is-active --quiet apache2; then
    a2enmod proxy proxy_http headers >/dev/null
    R="$(wire apache)"
    case "$R" in
      wired:*) F="${R#wired:}"; FILE="${F%%|*}"; BAK="${F#*|}"
        if apache2ctl configtest 2>/dev/null; then systemctl reload apache2; WIRED="Apache ($FILE; backup $BAK)"
        else cp "$BAK" "$FILE"; echo "WARN: Apache test failed — change rolled back ($FILE)"; fi ;;
      already:*) systemctl reload apache2; WIRED="Apache (already connected)" ;;
      *) echo "WARN: no <VirtualHost *:443> for $HOST found in /etc/apache2 — connect it by hand (below)" ;;
    esac
  fi
fi
if [ -n "$WIRED" ] && curl -fsk --resolve "$HOST:443:127.0.0.1" "https://$HOST$BASE_PATH/api/auth/sso/config" | grep -q '"localLogin"'; then
  cat <<EOF

============================================================
DONE — connected through $WIRED.
Open: $PUBLIC_URL/
EOF
elif [ -n "$NEED_CERT" ]; then
  cat <<EOF

============================================================
SUBoard is running and nginx forwards http://$HOST to it, but sign-in needs HTTPS.
Last step — issue a certificate (Let's Encrypt; the e-mail you give is sent to them):

  apt-get install -y certbot python3-certbot-nginx
  certbot --nginx -d $HOST --redirect

Then open: $PUBLIC_URL/
EOF
else
cat <<EOF

============================================================
SUBoard is running on 127.0.0.1:$PORT (not reachable from outside yet).
Last step — connect it to $PUBLIC_URL in your existing web server:

  nginx : add   include /etc/suboard/nginx-location.conf;   inside the HTTPS server block of ${ORIGIN#https://}
          then  nginx -t && systemctl reload nginx
  Apache: add   Include /etc/suboard/apache-location.conf   inside the <VirtualHost *:443>
          then  a2enmod proxy proxy_http headers && apachectl configtest && systemctl reload apache2

Then open: $PUBLIC_URL/
EOF
fi
if [ -n "$ADMIN_PW" ]; then
cat <<EOF
Administrator : $ADMIN_EMAIL
One-time password (shown once, not stored anywhere — change it after the first sign-in;
you will be asked to set up two-step verification): $ADMIN_PW
EOF
fi
echo "Logs: journalctl -u suboard -f      Update later: re-run this script (the database is backed up first)."
echo "Backups: $DATA_DIR/backups (daily, 14 kept) — copy them, encrypted, off this server."
echo "E-mail (notifications, forgot password): fill in SMTP_* in $ENV_FILE, then: systemctl restart suboard"
echo "============================================================"
