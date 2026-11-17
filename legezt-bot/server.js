// Entry point for the LEGEZT WhatsApp bot: wires the bot core to the local HTTP API and starts the service.
// Launched by PM2 (`pm2 start server.js --name legezt-bot`) or by `npm start`.
// Requires ./bot.js, ./api.js, and optional PORT, LEGEZT_AUTH_DIR, LEGEZT_PLUGIN_DIR, and LEGEZT_RELAY_KEY_FILE env vars.

const LegeztBot = require('./bot.js');
const { createApi } = require('./api.js');

const PORT = parseInt(process.env.PORT || '3001', 10);
const AUTH_DIR = process.env.LEGEZT_AUTH_DIR || '/var/legezt/auth';
const PLUGIN_DIR = process.env.LEGEZT_PLUGIN_DIR || require('path').join(__dirname, 'plugins');
const RELAY_KEY_FILE = process.env.LEGEZT_RELAY_KEY_FILE || '/var/legezt/config/relay.key';

function log(level, msg) {
  const line = `[${new Date().toISOString()}] [${level.toUpperCase()}] ${msg}`;
  if (level === 'error') {
    console.error(line);
  } else {
    console.log(line);
  }
}

process.on('unhandledRejection', (err) => log('error', 'unhandledRejection: ' + (err && err.message ? err.message : String(err))));
process.on('uncaughtException', (err) => log('error', 'uncaughtException: ' + (err && err.message ? err.message : String(err))));

async function main() {
  const bot = new LegeztBot({ authDir: AUTH_DIR, pluginDir: PLUGIN_DIR, log });
  const app = createApi(bot, { relayKeyFile: RELAY_KEY_FILE, log });
  const server = app.listen(PORT, '127.0.0.1', () => {
    log('info', 'legezt-bot API listening on 127.0.0.1:' + PORT);
  });

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    log('info', 'Shutting down…');
    server.close();

    try {
      if (typeof bot.shutdown === 'function') {
        await bot.shutdown();
      }
    } catch (err) {
      log('error', 'Bot shutdown failed: ' + (err && err.message ? err.message : String(err)));
    } finally {
      process.exit(0);
    }
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  log('info', 'legezt-bot 2.0.0 started (port ' + PORT + ', authDir ' + AUTH_DIR + ')');

  try {
    await bot.start();
  } catch (err) {
    log('error', 'Bot start failed (API still up): ' + (err && err.message ? err.message : String(err)));
  }
}

main().catch((err) => {
  log('error', 'Startup failed: ' + (err && err.message ? err.message : String(err)));
});
