#!/usr/bin/env bash
# SUBoard doctor — read-only checks of a server installed with deploy/install.sh.
# It changes nothing and never prints secrets (only PORT and PUBLIC_URL are read from the .env file).
#
#   sudo suboard-doctor
#
# Each line is OK / WARN / FAIL with the next step. Exit code: 0 = no FAIL, 1 = at least one FAIL.
set -uo pipefail

APP_DIR="${SUBOARD_APP_DIR:-/opt/suboard}"
DATA_DIR="${SUBOARD_DATA_DIR:-/var/lib/suboard}"
ENV_FILE="${SUBOARD_ENV_FILE:-$APP_DIR/.env}"
FAILS=0
ok()   { printf 'OK    %s\n' "$*"; }
warn() { printf 'WARN  %s\n' "$*"; }
fail() { printf 'FAIL  %s\n' "$*"; FAILS=$((FAILS + 1)); }
# One key of the .env file, without sourcing it (the file holds secrets and is not shell code).
env_get() { [ -r "$ENV_FILE" ] && sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | tr -d '\r"' | sed "s/^'//; s/'\$//"; }

echo "SUBoard doctor — $(date '+%Y-%m-%d %H:%M')"
[ -r "$ENV_FILE" ] || { fail "cannot read $ENV_FILE — run as root: sudo suboard-doctor"; echo "Result: FAIL"; exit 1; }

PORT="$(env_get PORT)"; PORT="${PORT:-3000}"
PUBLIC_URL="$(env_get PUBLIC_URL)"; PUBLIC_URL="${PUBLIC_URL%/}"
ORIGIN="$(printf '%s' "$PUBLIC_URL" | sed -E 's#^(https?://[^/]+).*#\1#')"
BASE_PATH="${PUBLIC_URL#"$ORIGIN"}"
HOST="${ORIGIN#*://}"
echo "      address: ${PUBLIC_URL:-<PUBLIC_URL is not set>}   local port: $PORT"

# 1. the service
if systemctl is-active --quiet suboard 2>/dev/null; then ok "service 'suboard' is running"
else fail "service 'suboard' is not running — see: journalctl -u suboard -n 40 --no-pager   then: systemctl restart suboard"; fi

# 2. the application answers locally, and it is SUBoard (not another program on the same port)
if curl -fsS -m 5 "http://127.0.0.1:$PORT$BASE_PATH/api/health" 2>/dev/null | grep -q '"status":"ok"'; then
  if curl -fsS -m 5 "http://127.0.0.1:$PORT$BASE_PATH/api/auth/sso/config" 2>/dev/null | grep -q '"localLogin"'; then ok "SUBoard answers on 127.0.0.1:$PORT$BASE_PATH"
  else fail "something answers on port $PORT but it is not SUBoard — another application uses this port"; fi
else fail "nothing answers on 127.0.0.1:$PORT$BASE_PATH/api/health — the service is down or uses another port"; fi

# 3. the web app was built for this address
PAGE="$(curl -fsS -m 5 "http://127.0.0.1:$PORT$BASE_PATH/" 2>/dev/null || true)"
if printf '%s' "$PAGE" | grep -q "$BASE_PATH/assets/"; then ok "the web app is built for '${BASE_PATH:-/}'"
elif [ -n "$PAGE" ]; then fail "the web app was built for a different address — re-run the installer with $PUBLIC_URL"
else fail "the web app is not served (no page at 127.0.0.1:$PORT$BASE_PATH/) — re-run the installer"; fi

# 4. the web server forwards the address to SUBoard
WIRED=""
for d in /etc/nginx/sites-enabled /etc/nginx/conf.d /etc/apache2/sites-enabled /etc/apache2/conf-enabled; do
  [ -d "$d" ] && grep -rlsE 'suboard/(nginx-location|apache-location)\.conf' "$d" >/dev/null 2>&1 && WIRED="$d"
done
if [ -n "$WIRED" ]; then ok "the web server includes the SUBoard snippet ($WIRED)"
else fail "no web-server site includes /etc/suboard/nginx-location.conf — the line was removed (e.g. another deployment rewrote the site file). Re-run the installer: it puts the line back and keeps a backup of the file"; fi

# 5. the public address reaches SUBoard (tested against this machine, so DNS / CDN are not part of the test)
if [ -n "$HOST" ]; then
  PUB="$(curl -fsSk -m 8 --resolve "$HOST:443:127.0.0.1" "https://$HOST$BASE_PATH/api/auth/sso/config" 2>/dev/null || true)"
  if printf '%s' "$PUB" | grep -q '"localLogin"'; then ok "https://$HOST$BASE_PATH reaches SUBoard"
  else
    CODE="$(curl -sk -m 8 -o /dev/null -w '%{http_code}' --resolve "$HOST:443:127.0.0.1" "https://$HOST$BASE_PATH/" 2>/dev/null || echo 000)"
    fail "https://$HOST$BASE_PATH does not reach SUBoard (HTTP $CODE). If check 2 is OK, the web server is sending this address somewhere else — see check 4"
  fi
else warn "PUBLIC_URL is not set in $ENV_FILE"; fi

# 6. backups
LAST="$(ls -1t "$DATA_DIR"/backups/suboard-*.db 2>/dev/null | head -1)"
if [ -n "$LAST" ]; then
  AGE_H=$(( ( $(date +%s) - $(stat -c %Y "$LAST") ) / 3600 ))
  if [ "$AGE_H" -le 30 ]; then ok "last database backup is ${AGE_H}h old ($(basename "$LAST"))"
  else warn "last database backup is ${AGE_H}h old — the daily job (/etc/cron.d/suboard-backup) is not running"; fi
  warn "backups are on this disk only ($DATA_DIR/backups) — copy them, encrypted, to another machine"
else warn "no database backup found in $DATA_DIR/backups"; fi

# 7. disk space
FREE_MB="$(df -Pm "$DATA_DIR" 2>/dev/null | awk 'NR==2 {print $4}')"
if [ -n "${FREE_MB:-}" ]; then
  if [ "$FREE_MB" -lt 500 ]; then fail "only ${FREE_MB} MB free where the data lives ($DATA_DIR) — uploads and backups will start to fail"
  elif [ "$FREE_MB" -lt 2000 ]; then warn "${FREE_MB} MB free where the data lives ($DATA_DIR)"
  else ok "${FREE_MB} MB free where the data lives"; fi
fi

# 8. virus scanner (without it uploaded files stay in quarantine)
if systemctl is-active --quiet clamav-daemon 2>/dev/null; then ok "ClamAV is running (uploads are scanned)"
else warn "ClamAV (clamav-daemon) is not running — uploaded files stay in quarantine until it is: systemctl start clamav-daemon"; fi

# 9. e-mail
if [ -n "$(env_get SMTP_HOST)" ]; then ok "SMTP is configured (send yourself a 'forgot password' e-mail to test it)"
else warn "SMTP is not configured in $ENV_FILE — no password reset by e-mail and no e-mail notifications"; fi

# 10. version
VER="$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' "$APP_DIR/apps/server/package.json" 2>/dev/null | head -1)"
[ -n "$VER" ] && echo "      installed version: $VER"

if [ "$FAILS" -eq 0 ]; then echo "Result: no failures"; exit 0; fi
echo "Result: $FAILS failure(s) — fix the FAIL lines from the top down"
exit 1
