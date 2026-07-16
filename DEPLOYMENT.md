# PR Guardian — Self-Hosted Deployment Guide

Deploy PR Guardian on your own Linux server (Ubuntu/Debian) using **PM2** for process management and **nginx** as a reverse proxy.

---

## Stack

| Layer | Tool |
|-------|------|
| Python API | `uvicorn` managed by **PM2** |
| React UI | Built static files served by **nginx** |
| Reverse Proxy | **nginx** |
| Process Manager | **PM2** |
| SSL (optional) | **Certbot / Let's Encrypt** |

---

## Prerequisites

```bash
# Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# PM2
sudo npm install -g pm2

# Python 3.11+ and pip
sudo apt install -y python3 python3-pip python3-venv

# nginx
sudo apt install -y nginx

# Certbot (optional, for HTTPS)
sudo apt install -y certbot python3-certbot-nginx
```

---

## 1. Clone & Configure

```bash
git clone https://github.com/YOUR_ORG/pr-guardian.git /opt/pr-guardian
cd /opt/pr-guardian

cp .env.example .env
nano .env
```

### Required `.env` values

```env
BITBUCKET_CLIENT_ID=your_client_id
BITBUCKET_CLIENT_SECRET=your_client_secret
OPENAI_API_KEY=sk-...
SECRET_KEY=a_long_random_secret_for_sessions
DATABASE_URL=sqlite:///./data/prguardian.db
PORT=8000
```

---

## 2. Set Up Python Virtual Environment

```bash
cd /opt/pr-guardian
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
deactivate
```

---

## 3. Build the React UI

```bash
cd /opt/pr-guardian/ui
npm install
npm run build
# Output: /opt/pr-guardian/ui/dist
```

---

## 4. PM2 Ecosystem Config

Create `/opt/pr-guardian/ecosystem.config.js`:

```js
module.exports = {
  apps: [
    {
      name: 'pr-guardian-api',
      script: '/opt/pr-guardian/.venv/bin/uvicorn',
      args: 'api.server:app --host 127.0.0.1 --port 8000 --workers 2',
      cwd: '/opt/pr-guardian',
      interpreter: 'none',
      env: {
        PATH: '/opt/pr-guardian/.venv/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
      },
      env_file: '/opt/pr-guardian/.env',
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',
      out_file: '/var/log/pr-guardian/api-out.log',
      error_file: '/var/log/pr-guardian/api-err.log',
      merge_logs: true,
    },
  ],
};
```

```bash
# Create log directory
sudo mkdir -p /var/log/pr-guardian
sudo chown $USER:$USER /var/log/pr-guardian

# Start and persist PM2 process
pm2 start /opt/pr-guardian/ecosystem.config.js
pm2 save

# Configure PM2 to run on system boot
pm2 startup systemd
# Run the command it outputs
```

### Useful PM2 commands

```bash
pm2 status                    # Show all processes
pm2 logs pr-guardian-api      # Tail API logs
pm2 restart pr-guardian-api   # Restart API
pm2 stop pr-guardian-api      # Stop API
pm2 reload pr-guardian-api    # Zero-downtime reload
```

---

## 5. nginx Configuration

Create `/etc/nginx/sites-available/pr-guardian`:

```nginx
server {
    listen 80;
    server_name your-domain.com www.your-domain.com;

    # React UI — serve built static files
    root /opt/pr-guardian/ui/dist;
    index index.html;

    # API reverse proxy
    location /api/ {
        proxy_pass         http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_set_header   Upgrade           $http_upgrade;
        proxy_set_header   Connection        "upgrade";
        proxy_read_timeout 300s;
        proxy_send_timeout 300s;
        client_max_body_size 50M;
    }

    # Webhook endpoint (longer timeout for async ops)
    location /webhook {
        proxy_pass         http://127.0.0.1:8000;
        proxy_http_version 1.1;
        proxy_set_header   Host              $host;
        proxy_set_header   X-Real-IP         $remote_addr;
        proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
        proxy_read_timeout 600s;
    }

    # SPA fallback — all unknown routes -> index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # Static asset caching
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff2?)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Security headers
    add_header X-Content-Type-Options  "nosniff"       always;
    add_header X-Frame-Options         "SAMEORIGIN"    always;
    add_header Referrer-Policy         "strict-origin" always;
    add_header X-XSS-Protection        "1; mode=block" always;
}
```

```bash
# Enable site
sudo ln -s /etc/nginx/sites-available/pr-guardian /etc/nginx/sites-enabled/
sudo nginx -t          # Test config — must say "ok"
sudo systemctl reload nginx
```

---

## 6. SSL with Let's Encrypt (Recommended)

```bash
sudo certbot --nginx -d your-domain.com -d www.your-domain.com

# Test auto-renewal
sudo certbot renew --dry-run
```

Certbot will automatically modify your nginx config to add HTTPS and redirect HTTP → HTTPS.

---

## 7. Firewall

```bash
sudo ufw allow 'Nginx Full'   # ports 80 + 443
sudo ufw allow OpenSSH
sudo ufw enable
sudo ufw status
```

---

## 8. Deployment Updates

```bash
cd /opt/pr-guardian
git pull

# If Python dependencies changed:
source .venv/bin/activate && pip install -r requirements.txt && deactivate

# Restart API (zero-downtime)
pm2 reload pr-guardian-api

# If UI changed:
cd ui && npm install && npm run build
# nginx picks up new /dist files automatically — no restart needed
```

---

## 9. Verify Everything

```bash
# PM2 processes
pm2 status

# API health
curl http://127.0.0.1:8000/health

# nginx
sudo systemctl status nginx

# Logs
pm2 logs pr-guardian-api --lines 50
sudo tail -f /var/log/nginx/error.log
```

---

## Directory Structure

```
/opt/pr-guardian/
├── .env                        ← environment variables (keep secret!)
├── ecosystem.config.js         ← PM2 config
├── .venv/                      ← Python virtualenv
├── api/                        ← FastAPI backend
├── ui/
│   └── dist/                   ← built React app (nginx serves this)
└── data/                       ← SQLite DB and data files

/etc/nginx/sites-available/pr-guardian   ← nginx site config
/var/log/pr-guardian/                    ← API logs
```

---

> **Tip:** If running multiple services on the same server, assign different ports (e.g. `8001`) in `ecosystem.config.js` and update `proxy_pass` in nginx accordingly.
