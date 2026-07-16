/**
 * PM2 Ecosystem Config — PR Guardian
 *
 * Environment variables read from .env (via env_file):
 *   API_PORT   — port uvicorn listens on (default: 8000)
 *
 * Usage:
 *   pm2 start ecosystem.config.js           # start
 *   pm2 reload ecosystem.config.js          # zero-downtime reload
 *   pm2 save                                # persist across reboots
 *   pm2 startup                             # install systemd service
 */

require('dotenv').config();   // load .env so we can read vars here too

const APP_DIR  = __dirname;
const VENV_BIN = `${APP_DIR}/.venv/bin`;
const API_PORT = process.env.API_PORT || 8000;
const LOG_DIR  = '/var/log/pr-guardian';

module.exports = {
  apps: [
    {
      name: 'pr-guardian-api',

      // Run uvicorn directly from the virtualenv — no wrapper script needed
      script: `${VENV_BIN}/uvicorn`,
      args: `api.server:app --host 127.0.0.1 --port ${API_PORT} --workers 2`,
      interpreter: 'none',
      cwd: APP_DIR,

      // Inject PATH so uvicorn can find its own dependencies
      env: {
        PATH: `${VENV_BIN}:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin`,
        PYTHONUNBUFFERED: '1',
      },
      env_file: `${APP_DIR}/.env`,

      // Process lifecycle
      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 5000,

      // Logging
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file:   `${LOG_DIR}/api-out.log`,
      error_file: `${LOG_DIR}/api-err.log`,
      merge_logs: true,

      // PM2 Plus monitoring (optional)
      instance_var: 'INSTANCE_ID',
    },
  ],
};
