// Registers the Ops dashboard endpoints on the legezt-bot HTTP API.
// Called by api.js inside createApi(); the route handlers get the bot, log,
// requireLocalApiKey, and reportError helpers through ctx.
// Requires fs, os, path, child_process, usage.js, vault.js, lib/chats.js.
// Localhost-only + relay key on every route; the vault key never leaves
// this process.
'use strict';

const fs = require('fs');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { getStats, readRecent } = require('./usage.js');
const { listVault, readByHash } = require('./vault.js');
const { listChats, readMessages, markRead, exportFiles, isValidJid } = require('./lib/chats.js');

// Ops helpers. Every helper is best-effort: a failing part returns null/[]
// and never takes down the endpoint.
const LOG_TAIL_BYTES = 256 * 1024;
const LOG_TAIL_LINES = 25;
const MAX_VAULT_DOWNLOAD_BYTES = 200 * 1024 * 1024;

function readTailLines(filePath, maxLines) {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) return [];
    const start = Math.max(0, stat.size - LOG_TAIL_BYTES);
    const fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    const lines = buf.toString('utf8').split('\n')
      .map((line) => line.replace(/\r$/, ''))
      .filter((line) => line !== '');
    return lines.slice(-maxLines);
  } catch (_) {
    return [];
  }
}

function pm2List() {
  return new Promise((resolve) => {
    execFile('pm2', ['jlist'], { timeout: 5000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) return resolve(null);
      try {
        const parsed = JSON.parse(stdout);
        if (!Array.isArray(parsed)) return resolve(null);
        const wanted = new Set(['legezt-bot', 'levanter', 'qr-session']);
        const out = [];
        for (const proc of parsed) {
          if (!proc || typeof proc.name !== 'string' || !wanted.has(proc.name)) continue;
          const env = proc.pm2_env || {};
          const monit = proc.monit || {};
          const pmUptime = typeof env.pm_uptime === 'number' ? env.pm_uptime : null;
          out.push({
            name: proc.name,
            status: typeof env.status === 'string' ? env.status : 'unknown',
            uptimeSec: pmUptime === null
              ? null
              : Math.max(0, Math.floor((Date.now() - pmUptime) / 1000)),
            restarts: typeof env.restart_time === 'number' ? env.restart_time : null,
            memoryBytes: typeof monit.memory === 'number' ? monit.memory : null
          });
        }
        return resolve(out);
      } catch (_) {
        return resolve(null);
      }
    });
  });
}

const VAULT_MIME = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
  webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', ogg: 'audio/ogg', opus: 'audio/ogg',
  m4a: 'audio/mp4', wav: 'audio/wav',
  zip: 'application/zip', txt: 'text/plain',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
};

// A training export is capped so one download can never exhaust the
// server's memory or the dashboard's temp file. The size is checked
// BEFORE streaming starts, so a too-large export fails cleanly.
const MAX_EXPORT_BYTES = 500 * 1024 * 1024;

// Streams day-files one after another into the response (each file is
// already chronological JSONL). A file that cannot be read is skipped;
// the client disconnect ends the stream. Never throws.
function streamExportFiles(res, files, filename) {
  return new Promise((resolve) => {
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    let index = 0;
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      try { res.end(); } catch (_) {}
      resolve();
    };
    res.on('close', () => {
      finished = true;
      resolve();
    });
    const next = () => {
      if (finished) return;
      if (index >= files.length) return finish();
      const file = files[index++].file;
      const stream = fs.createReadStream(file);
      stream.on('error', next);
      stream.on('end', next);
      stream.pipe(res, { end: false });
    };
    next();
  });
}

function vaultExt(name) {
  return String(name || '').split('.').pop().toLowerCase();
}

function vaultMime(name) {
  return VAULT_MIME[vaultExt(name)] || 'application/octet-stream';
}

function vaultType(name) {
  const ext = vaultExt(name);
  if (ext === 'pdf') return 'PDF';
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].includes(ext)) return 'Image';
  if (['mp4', 'webm', 'mov'].includes(ext)) return 'Video';
  if (['mp3', 'ogg', 'opus', 'm4a', 'wav'].includes(ext)) return 'Audio';
  if (ext === 'zip') return 'Archive';
  if (['txt', 'docx', 'doc'].includes(ext)) return 'Document';
  return 'File';
}

function registerOpsRoutes(app, ctx) {
  const { bot, log, requireLocalApiKey, reportError } = ctx;

  // Ops dashboard data: status + usage stats + recent events + PM2 state +
  // recent log lines + vault file list.
  app.get('/api/ops', async (req, res) => {
    try {
      if (!requireLocalApiKey(req, res)) {
        return;
      }

      const stats = getStats();
      const byType = stats.byType || {};
      const ai = byType.ai || {};
      let tasks = 0;
      let tasksOk = 0;
      let tasksFail = 0;
      for (const entry of Object.values(byType)) {
        tasks += entry.count || 0;
        tasksOk += entry.ok || 0;
        tasksFail += entry.fail || 0;
      }

      const logsDir = path.join(os.homedir(), '.pm2', 'logs');
      const [pm2, outLines, errLines] = await Promise.all([
        pm2List(),
        Promise.resolve(readTailLines(path.join(logsDir, 'legezt-bot-out.log'), LOG_TAIL_LINES)),
        Promise.resolve(readTailLines(path.join(logsDir, 'legezt-bot-error.log'), LOG_TAIL_LINES))
      ]);

      const vault = listVault().map((entry) => ({
        ...entry,
        type: vaultType(entry.originalName)
      }));

      // Loaded plugins, for the dashboard Plugins page (Phase 3).
      const plugins = [];
      if (bot && bot.plugins instanceof Map) {
        for (const plugin of bot.plugins.values()) {
          if (!plugin || typeof plugin.command !== 'string') continue;
          plugins.push({
            name: typeof plugin.name === 'string' ? plugin.name : plugin.command,
            command: plugin.command,
            description: typeof plugin.description === 'string' ? plugin.description : ''
          });
        }
      }
      plugins.sort((a, b) => a.command.localeCompare(b.command));

      return res.json({
        ok: true,
        checkedAt: new Date().toISOString(),
        status: bot.getStatus() || {},
        plugins,
        totals: {
          aiCalls: ai.count || 0,
          aiTokens: ai.tokens || 0,
          aiInputTokens: ai.inputTokens || 0,
          aiOutputTokens: ai.outputTokens || 0,
          tasks,
          tasksOk,
          tasksFail
        },
        stats,
        recent: readRecent(20),
        pm2,
        logs: { out: outLines, error: errLines },
        vault
      });
    } catch (err) {
      reportError('GET /api/ops failed', err);
      return res.status(500).json({ ok: false, error: 'internal' });
    }
  });

  // Phase 4 — Chats: the training store's list, thread, and export.
  // Every route is localhost-only + relay key, like /api/ops.
  app.get('/api/chats', (req, res) => {
    try {
      if (!requireLocalApiKey(req, res)) {
        return;
      }

      const chats = listChats();
      return res.json({ ok: true, chats, total: chats.length });
    } catch (err) {
      reportError('GET /api/chats failed', err);
      return res.status(500).json({ ok: false, error: 'internal' });
    }
  });

  // Full training export: every archived message, one JSON line each,
  // grouped by chat (each line carries its chat JID). Registered BEFORE
  // the :jid routes so "export" is never mistaken for a chat JID.
  app.get('/api/chats/export', async (req, res) => {
    try {
      if (!requireLocalApiKey(req, res)) {
        return;
      }

      const files = exportFiles(null);
      const total = files.reduce((sum, f) => sum + f.bytes, 0);
      if (total > MAX_EXPORT_BYTES) {
        return res.status(413).json({ ok: false, error: 'export-too-large' });
      }

      const stamp = new Date().toISOString().slice(0, 10);
      await streamExportFiles(res, files, `legezt-chats-${stamp}.jsonl`);
    } catch (err) {
      reportError('GET /api/chats/export failed', err);
      if (!res.headersSent) {
        return res.status(500).json({ ok: false, error: 'internal' });
      }
    }
  });

  // One chat's messages, oldest first in the page. `before` is an ISO
  // cursor (only messages older than it are returned); `markRead=1`
  // clears the chat's unread count.
  app.get('/api/chats/:jid/messages', (req, res) => {
    try {
      if (!requireLocalApiKey(req, res)) {
        return;
      }

      const jid = req.params.jid;
      if (!isValidJid(jid)) {
        return res.status(400).json({ ok: false, error: 'invalid-jid' });
      }

      const before = typeof req.query.before === 'string' && req.query.before !== ''
        ? req.query.before
        : null;
      if (before !== null && Number.isNaN(Date.parse(before))) {
        return res.status(400).json({ ok: false, error: 'invalid-before' });
      }

      const page = readMessages(jid, { limit: req.query.limit, before });
      if (req.query.markRead === '1') markRead(jid);
      const chat = listChats().find((c) => c.jid === jid) || {
        jid,
        name: null,
        number: null,
        isGroup: jid.endsWith('@g.us'),
        unread: 0
      };
      return res.json({
        ok: true,
        chat,
        messages: page.messages,
        hasMore: page.hasMore,
        oldestTs: page.oldestTs
      });
    } catch (err) {
      reportError('GET /api/chats/:jid/messages failed', err);
      return res.status(500).json({ ok: false, error: 'internal' });
    }
  });

  // Per-chat training export: that chat's day files, oldest first.
  app.get('/api/chats/:jid/export', async (req, res) => {
    try {
      if (!requireLocalApiKey(req, res)) {
        return;
      }

      const jid = req.params.jid;
      if (!isValidJid(jid)) {
        return res.status(400).json({ ok: false, error: 'invalid-jid' });
      }

      const files = exportFiles(jid);
      const total = files.reduce((sum, f) => sum + f.bytes, 0);
      if (total > MAX_EXPORT_BYTES) {
        return res.status(413).json({ ok: false, error: 'export-too-large' });
      }

      const stamp = new Date().toISOString().slice(0, 10);
      const safe = jid.replace(/[^A-Za-z0-9]/g, '_').slice(0, 60);
      await streamExportFiles(res, files, `legezt-chat-${safe}-${stamp}.jsonl`);
    } catch (err) {
      reportError('GET /api/chats/:jid/export failed', err);
      if (!res.headersSent) {
        return res.status(500).json({ ok: false, error: 'internal' });
      }
    }
  });

  // Restart the bot: reply first, then exit so PM2 restarts the process.
  // The dashboard's Restart button uses this.
  app.post('/api/restart', (req, res) => {
    try {
      if (!requireLocalApiKey(req, res)) {
        return;
      }

      log('info', 'Ops restart requested — exiting so PM2 restarts the bot');
      res.json({ ok: true, restarting: true });
      setTimeout(() => { process.exit(0); }, 400);
    } catch (err) {
      reportError('POST /api/restart failed', err);
      if (!res.headersSent) {
        return res.status(500).json({ ok: false, error: 'internal' });
      }
    }
  });

  // Decrypt and stream one vault file (by content hash) to the dashboard.
  // The key never leaves the bot; only the decrypted bytes are sent, and
  // the hash (never the content) is logged.
  app.post('/api/vault/download', (req, res) => {
    try {
      if (!requireLocalApiKey(req, res)) {
        return;
      }

      const hash = req.body && req.body.hash;
      if (typeof hash !== 'string' || /^[0-9a-f]{64}$/.test(hash) !== true) {
        return res.status(400).json({ ok: false, error: 'invalid-hash' });
      }

      let data = null;
      try {
        data = readByHash(hash);
      } catch (err) {
        log('error', `Vault download failed for ${hash.slice(0, 8)}: ${err.message}`);
        return res.status(500).json({ ok: false, error: 'decrypt-failed' });
      }

      if (data === null) {
        return res.status(404).json({ ok: false, error: 'not-found' });
      }

      if (data.length > MAX_VAULT_DOWNLOAD_BYTES) {
        return res.status(413).json({ ok: false, error: 'too-large' });
      }

      const entry = listVault().find((item) => item.hash === hash);
      const filename = entry ? entry.originalName : 'file';
      const safeName = String(filename).replace(/[^\x20-\x7E]/g, '_').replace(/["\\]/g, '_');

      res.setHeader('Content-Type', vaultMime(filename));
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      res.setHeader('Content-Length', String(data.length));
      return res.send(data);
    } catch (err) {
      reportError('POST /api/vault/download failed', err);
      if (!res.headersSent) {
        return res.status(500).json({ ok: false, error: 'internal' });
      }
    }
  });
}

module.exports = { registerOpsRoutes };
