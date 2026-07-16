/**
 * PM2 Ecosystem Config — PR Guardian
 *
 * Reads API_PORT from .env using Node built-in 'fs' — no npm install needed.
 *
 * Commands:
 *   pm2 start ecosystem.config.js      # start
 *   pm2 reload ecosystem.config.js     # zero-downtime reload
 *   pm2 save                           # persist across reboots
 *   pm2 startup                        # enable on boot
 */

const fs   = require('fs');
const path = require('path');

// Parse .env without any external dependency
function loadEnv(file) {
  const env = {};
  try {
    fs.readFileSync(file, 'utf8').split('\n').forEach(function(line) {
      var m = line.match(/^\s*([^#\s=][^=]*?)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    });
  } catch (_) {}
  return env;
}

var APP_DIR  = __dirname;
var env      = loadEnv(path.join(APP_DIR, '.env'));
var VENV_BIN = path.join(APP_DIR, '.venv', 'bin');
var API_PORT = env.API_PORT || process.env.API_PORT || 8000;
var LOG_DIR  = '/var/log/pr-guardian';

module.exports = {
  apps: [
    {
      name: 'pr-guardian-api',

      script: path.join(VENV_BIN, 'uvicorn'),
      args: 'api.server:app --host 127.0.0.1 --port ' + API_PORT + ' --workers 2',
      interpreter: 'none',
      cwd: APP_DIR,

      env: {
        PATH: VENV_BIN + ':/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
        PYTHONUNBUFFERED: '1',
      },
      env_file: path.join(APP_DIR, '.env'),

      watch: false,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 3000,
      kill_timeout: 5000,

      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      out_file:   path.join(LOG_DIR, 'api-out.log'),
      error_file: path.join(LOG_DIR, 'api-err.log'),
      merge_logs: true,
    },
  ],
};
