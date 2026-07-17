#!/usr/bin/env bash
# deploy.sh — PR Guardian deploy/update script
#
# Assumes the server already has:
#   - repo cloned at this directory
#   - Python venv at .venv/
#   - Node / npm installed
#   - PM2 installed globally
#   - nginx installed
#
# Usage:
#   ./deploy.sh            # pull + build + reload everything
#   ./deploy.sh --api      # restart API only (PM2 reload)
#   ./deploy.sh --ui       # rebuild UI only
#   ./deploy.sh --nginx    # regenerate nginx config and reload
#   ./deploy.sh --status   # show PM2 status + API health

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="$APP_DIR/.env"

# ── Load .env ────────────────────────────────────────────────
[[ -f "$ENV_FILE" ]] || { echo "ERROR: .env not found"; exit 1; }
set -a; source "$ENV_FILE"; set +a

API_PORT="${API_PORT:-8000}"
DOMAIN="${DOMAIN:-}"
PM2_APP="pr-guardian-api"
LOG_DIR="/var/log/pr-guardian"
NGINX_CONF="/etc/nginx/sites-available/pr-guardian"

GREEN='\033[0;32m'; NC='\033[0m'
info() { echo -e "${GREEN}▶${NC} $*"; }

# ── Steps ────────────────────────────────────────────────────

pull() {
  info "Pulling latest code..."
  git -C "$APP_DIR" pull --ff-only
}

install_deps() {
  info "Installing Python dependencies..."
  "$APP_DIR/.venv/bin/pip" install --quiet -r "$APP_DIR/requirements.txt"
}

build_ui() {
  info "Building React UI..."
  cd "$APP_DIR/ui"
  npm install --silent
  npm run build
  cd "$APP_DIR"
  info "UI built → ui/dist"
}

reload_api() {
  info "Reloading API (PM2)..."
  mkdir -p "$LOG_DIR"
  if pm2 list | grep -q "$PM2_APP"; then
    pm2 reload "$APP_DIR/ecosystem.config.js" --update-env
  else
    pm2 start "$APP_DIR/ecosystem.config.js"
    pm2 save
  fi
  info "API running on port $API_PORT"
}

nginx_config() {
  info "Writing nginx config..."
  local server_name="${DOMAIN:-_}"
  [[ -n "$DOMAIN" && "$DOMAIN" != www.* ]] && server_name="$DOMAIN www.$DOMAIN"

  sudo tee "$NGINX_CONF" > /dev/null << NGINXEOF
server {
    listen 80;
    server_name ${server_name};

    root ${APP_DIR}/ui/dist;
    index index.html;

    location ~ ^/(analyze|repos|health|feedback|retrain|bitbucket) {
        proxy_pass         http://127.0.0.1:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 300s;
        client_max_body_size 50M;
    }

    location /webhook {
        proxy_pass         http://127.0.0.1:${API_PORT};
        proxy_http_version 1.1;
        proxy_set_header   Host              \$host;
        proxy_set_header   X-Real-IP         \$remote_addr;
        proxy_set_header   X-Forwarded-For   \$proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto \$scheme;
        proxy_read_timeout 600s;
    }

    location ~* \.(js|css|png|jpg|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    location / {
        try_files \$uri \$uri/ /index.html;
    }

    add_header X-Content-Type-Options "nosniff"    always;
    add_header X-Frame-Options        "SAMEORIGIN" always;
    add_header Referrer-Policy        "strict-origin" always;
}
NGINXEOF

  [[ -L /etc/nginx/sites-enabled/pr-guardian ]] || \
    sudo ln -sf "$NGINX_CONF" /etc/nginx/sites-enabled/pr-guardian

  sudo nginx -t && sudo systemctl reload nginx
  info "nginx reloaded"
}

status() {
  pm2 status "$PM2_APP" 2>/dev/null || echo "PM2 process not found"
  curl -sf "http://127.0.0.1:${API_PORT}/health" \
    && echo -e "\n${GREEN}API healthy${NC}" \
    || echo "API not responding"
}

# ── Entrypoint ───────────────────────────────────────────────
case "${1:-}" in
  --api)    reload_api ;;
  --ui)     build_ui ;;
  --nginx)  nginx_config ;;
  --status) status ;;
  "")
    pull
    install_deps
    build_ui
    reload_api
    echo ""
    info "Done. API on :${API_PORT}${DOMAIN:+, Web on https://$DOMAIN}"
    ;;
  *)
    echo "Usage: $0 [--api | --ui | --nginx | --status]"
    exit 1
    ;;
esac
