// Appends one JSON line per event to /var/legezt/storage/usage.jsonl for the dashboard.
// Called by bot.js on every plugin invocation and by the .ai plugin (with token counts).
// Needs only Node fs/crypto; never crashes on a failed write; never logs keys, message text, or phone numbers.
//
// Data structures (SPEC 13):
// - Disk: append-only JSONL, one line per event. Rotated when the active file
//   passes 10 MB (renamed to usage-<timestamp>.jsonl, a fresh file started).
// - Memory: aggregates in Maps so the dashboard reads O(1) without scanning
//   the file — byCommand (bounded by the distinct command count, ~20),
//   byType (3 types), byDay (capped to the last 30 days, older days pruned).
//   Aggregates are in-memory only and reset on restart; the JSONL is the
//   durable source of truth.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const USAGE_FILE = process.env.LEGEZT_USAGE_FILE || '/var/legezt/storage/usage.jsonl';
const MAX_USAGE_BYTES = 10 * 1024 * 1024;
const MAX_DAY_ENTRIES = 30;

const byCommand = new Map();
const byType = new Map();
const byDay = new Map();

function dayKey(isoTime) {
  return String(isoTime || '').slice(0, 10);
}

function emptyAggregate() {
  return { count: 0, ok: 0, fail: 0, tokens: 0, totalMs: 0 };
}

function bump(map, key, line) {
  let entry = map.get(key);
  if (!entry) {
    entry = emptyAggregate();
    map.set(key, entry);
  }
  entry.count += 1;
  if (line.ok) entry.ok += 1;
  else entry.fail += 1;
  if (typeof line.tokens === 'number') entry.tokens += line.tokens;
  if (typeof line.durationMs === 'number') entry.totalMs += line.durationMs;
  return entry;
}

function recordAggregate(line) {
  if (line.command) bump(byCommand, line.command, line);
  if (line.type) bump(byType, line.type, line);
  const day = dayKey(line.time);
  if (day) {
    bump(byDay, day, line);
    // Cap: keep only the last 30 days, oldest dropped.
    while (byDay.size > MAX_DAY_ENTRIES) {
      const oldest = byDay.keys().next().value;
      byDay.delete(oldest);
    }
  }
}

// Snapshot of the in-memory aggregates for the dashboard. O(1) — no disk scan.
function getStats() {
  const snapshot = (map) => {
    const out = {};
    for (const [key, value] of map) out[key] = { ...value };
    return out;
  };
  return {
    byCommand: snapshot(byCommand),
    byType: snapshot(byType),
    byDay: snapshot(byDay)
  };
}

// The chat JID contains a phone number in plain text, so it is hashed
// (SHA-256) before it is stored. The dashboard groups by this hash.
function hashChat(jid) {
  if (typeof jid !== 'string' || !jid) return null;
  try {
    return crypto.createHash('sha256').update(jid).digest('hex');
  } catch (_) {
    return null;
  }
}

function rotateIfNeeded() {
  try {
    const stat = fs.statSync(USAGE_FILE);
    if (!stat.isFile() || stat.size <= MAX_USAGE_BYTES) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const rotated = USAGE_FILE.replace(/\.jsonl$/, `-${stamp}.jsonl`);
    fs.renameSync(USAGE_FILE, rotated);
  } catch (_) {
    // Rotation is best-effort; the append below still runs.
  }
}

function logUsage(event) {
  try {
    if (!event || typeof event !== 'object') return;
    const line = {
      time: new Date().toISOString(),
      type: typeof event.type === 'string' ? event.type : 'plugin',
      command: typeof event.command === 'string' ? event.command : null,
      chat: hashChat(event.chat),
      tokens: typeof event.tokens === 'number' && Number.isFinite(event.tokens) ? event.tokens : null,
      durationMs: typeof event.durationMs === 'number' && Number.isFinite(event.durationMs) ? Math.round(event.durationMs) : null,
      ok: event.ok === true
    };
    if (typeof event.inputTokens === 'number' && Number.isFinite(event.inputTokens)) {
      line.inputTokens = event.inputTokens;
    }
    if (typeof event.outputTokens === 'number' && Number.isFinite(event.outputTokens)) {
      line.outputTokens = event.outputTokens;
    }
    if (typeof event.file === 'string' && event.file) line.file = event.file;
    recordAggregate(line);
    const dir = path.dirname(USAGE_FILE);
    fs.mkdirSync(dir, { recursive: true });
    rotateIfNeeded();
    fs.appendFileSync(USAGE_FILE, JSON.stringify(line) + '\n', 'utf8');
  } catch (_) {
    // Usage logging must never crash the bot or a plugin.
  }
}

module.exports = { logUsage, hashChat, getStats };
