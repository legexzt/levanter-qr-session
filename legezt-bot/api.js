// Provides the LEGEZT bot's localhost HTTP API for the PHP dashboard and curl tests.
// server.js passes in a LegeztBot instance from bot.js and handles app.listen().
// Requires express, fs, ops-api.js (Ops endpoints), the bot instance, and a
// relay key from its file or environment.
'use strict';

const express = require('express');
const fs = require('fs');
const { registerOpsRoutes } = require('./ops-api.js');

function isLocalhost(req) {
  const address = req.socket && req.socket.remoteAddress;
  return address === '127.0.0.1' ||
    address === '::1' ||
    address === '::ffff:127.0.0.1';
}

function createApi(bot, opts) {
  const options = opts || {};
  const relayKeyFile = options.relayKeyFile ||
    process.env.LEGEZT_RELAY_KEY_FILE ||
    '/var/legezt/config/relay.key';

  const log = typeof options.log === 'function'
    ? options.log
    : (level, msg) => {
        const line = `[${new Date().toISOString()}] [${level}] ${msg}`;
        if (level === 'error') {
          console.error(line);
        } else {
          console.log(line);
        }
      };

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '64kb' }));

  function loadRelayKey() {
    const envKey = process.env.LEGEZT_RELAY_KEY;
    if (typeof envKey === 'string' && envKey.length > 0) {
      return envKey.trim() || null;
    }

    try {
      if (!fs.existsSync(relayKeyFile)) {
        return null;
      }
      const key = fs.readFileSync(relayKeyFile, 'utf8').trim();
      return key || null;
    } catch (err) {
      log('error', `Could not read relay key file: ${err.message}`);
      return null;
    }
  }

  let cachedRelayKey = loadRelayKey();

  function getRelayKey() {
    if (cachedRelayKey === null) {
      cachedRelayKey = loadRelayKey();
    }
    return cachedRelayKey;
  }

  function reportError(context, err) {
    const detail = err && err.stack ? err.stack : String(err);
    log('error', `${context}: ${detail}`);
  }

  function requireLocalApiKey(req, res) {
    if (!isLocalhost(req)) {
      res.status(403).json({
        ok: false,
        error: 'localhost-only'
      });
      return false;
    }

    const key = getRelayKey();
    if (key === null) {
      res.status(503).json({
        ok: false,
        error: 'relay-key-not-configured',
        detail: 'Create /var/legezt/config/relay.key (mode 0640) or set LEGEZT_RELAY_KEY'
      });
      return false;
    }

    if (req.header('x-api-key') !== key) {
      res.status(401).json({
        ok: false,
        error: 'bad-api-key'
      });
      return false;
    }

    return true;
  }

  app.get('/', (req, res) => {
    try {
      return res.json({
        ok: true,
        service: 'legezt-bot',
        version: '2.0.0'
      });
    } catch (err) {
      reportError('GET / failed', err);
      return res.status(500).json({ ok: false, error: 'internal' });
    }
  });

  app.get('/api/health', (req, res) => {
    try {
      const current = bot.getStatus() || {};
      return res.status(200).json({
        ok: true,
        status: current.status,
        account: current.account,
        botUp: true,
        uptimeSec: current.uptimeSec
      });
    } catch (err) {
      reportError('GET /api/health failed', err);
      return res.status(500).json({ ok: false, error: 'internal' });
    }
  });

  app.get('/api/qr', (req, res) => {
    try {
      const qr = bot.getQr() || {};
      return res.status(200).json({ ...qr, ok: true });
    } catch (err) {
      reportError('GET /api/qr failed', err);
      return res.status(500).json({ ok: false, error: 'internal' });
    }
  });

  app.post('/api/disconnect', async (req, res) => {
    try {
      await bot.pause();
      const status = bot.getStatus();
      return res.json({ ok: true, status });
    } catch (err) {
      reportError('POST /api/disconnect failed', err);
      return res.status(500).json({ ok: false, error: 'internal' });
    }
  });

  app.post('/api/connect', async (req, res) => {
    try {
      await bot.resume();
      const status = bot.getStatus();
      return res.json({ ok: true, status });
    } catch (err) {
      reportError('POST /api/connect failed', err);
      return res.status(500).json({ ok: false, error: 'internal' });
    }
  });

  app.post('/api/muse-relay', async (req, res) => {
    try {
      if (!requireLocalApiKey(req, res)) {
        return;
      }

      const { message, from } = req.body || {};

      if (
        typeof message !== 'string' ||
        message.length < 1 ||
        message.length > 4000
      ) {
        return res.status(400).json({
          ok: false,
          error: 'invalid-body',
          detail: 'message must be a string of length 1..4000'
        });
      }

      if (
        from !== undefined &&
        (typeof from !== 'string' || from.length > 100)
      ) {
        return res.status(400).json({
          ok: false,
          error: 'invalid-body',
          detail: 'from must be a string of at most 100 characters'
        });
      }

      const relayFrom = from || 'muse-relay';
      const result = await bot.respond(message, relayFrom);

      log(
        'info',
        `Muse relay: from=${relayFrom} handledBy=${result.handledBy}`
      );

      return res.json({
        ok: true,
        reply: result.reply,
        handledBy: result.handledBy,
        from: relayFrom
      });
    } catch (err) {
      reportError('POST /api/muse-relay failed', err);
      return res.status(500).json({ ok: false, error: 'internal' });
    }
  });

  app.post('/api/pairing-code', async (req, res) => {
    try {
      if (!requireLocalApiKey(req, res)) {
        return;
      }

      const result = await bot.requestPairingCode();

      if (!result.ok) {
        const statusByError = {
          'not-waiting': 409,
          'phone-not-configured': 503,
          'no-socket': 503,
          'too-soon': 429,
          'request-failed': 502
        };
        return res.status(statusByError[result.error]).json({
          ok: false,
          error: result.error
        });
      }

      const qr = bot.getQr() || {};
      const qrAgeSec = qr.qrAgeSec ?? null;

      log('info', 'Pairing code refreshed on demand');

      return res.status(200).json({
        ok: true,
        pairingCode: result.pairingCode,
        qrAgeSec
      });
    } catch (err) {
      reportError('POST /api/pairing-code failed', err);
      return res.status(500).json({ ok: false, error: 'internal' });
    }
  });

  // Ops dashboard endpoints (GET /api/ops, POST /api/restart,
  // POST /api/vault/download) and Chats endpoints (GET /api/chats,
  // GET /api/chats/:jid/messages, GET /api/chats/export,
  // GET /api/chats/:jid/export) — localhost-only + relay key.
  registerOpsRoutes(app, { bot, log, requireLocalApiKey, reportError });

  app.use((req, res) => {
    return res.status(404).json({ ok: false, error: 'not-found' });
  });

  app.use((err, req, res, next) => {
    if (res.headersSent) {
      return next(err);
    }

    const isJsonParseError = err && (
      err.type === 'entity.parse.failed' ||
      (
        err instanceof SyntaxError &&
        err.status === 400 &&
        'body' in err
      )
    );

    if (isJsonParseError) {
      return res.status(400).json({
        ok: false,
        error: 'invalid-json'
      });
    }

    if (err && err.type === 'entity.too.large') {
      return res.status(413).json({
        ok: false,
        error: 'payload-too-large'
      });
    }

    reportError('Unhandled API error', err);
    return res.status(500).json({ ok: false, error: 'internal' });
  });

  return app;
}

module.exports = { createApi };
