# PR Guardian — Deployment

PM2 + nginx on your own Linux server.

---

## Key Files

| File | Purpose |
|------|---------|
| `.env` | All config — ports, keys, domain |
| `ecosystem.config.js` | PM2 process definition (reads `.env`) |
| `deploy.sh` | Deploy / update script |

---

## 1. Configure `.env`

```env
# ── Ports ──────────────────────────────────
API_PORT=8000      # backend (uvicorn)
UI_PORT=5173       # Vite dev server only

# ── Domain ─────────────────────────────────
# Used for nginx config AND webhook callback URL (https://DOMAIN/webhook/bitbucket)
DOMAIN=pr.your-company.com
```

---

## 2. Start with PM2

```bash
# Create log dir (first time only)
sudo mkdir -p /var/log/pr-guardian && sudo chown $USER /var/log/pr-guardian

# Start
pm2 start ecosystem.config.js
pm2 save

# Run on boot
pm2 startup
# → copy-paste the command it prints, then run it
```

---

## 3. nginx

Run the deploy script to generate and apply the nginx config:

```bash
./deploy.sh --nginx
```

This writes `/etc/nginx/sites-available/pr-guardian` with the correct port from `.env` and reloads nginx.

For SSL:
```bash
sudo certbot --nginx -d pr.your-company.com
```

---

## 4. Updating

```bash
./deploy.sh            # pull + pip install + build UI + PM2 reload + nginx reload

# Or individual steps:
./deploy.sh --api      # PM2 reload only (zero-downtime)
./deploy.sh --ui       # rebuild React UI only
./deploy.sh --nginx    # regenerate nginx config from .env
./deploy.sh --status   # PM2 status + API health check
```

---

## Changing the port

Edit `API_PORT` in `.env`, then:

```bash
./deploy.sh --api    # restarts uvicorn on new port
./deploy.sh --nginx  # rewrites nginx proxy_pass to new port
```
