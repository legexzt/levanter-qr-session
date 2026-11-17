// Training-ready WhatsApp message archive: one JSON line per message.
// Called by bot.js for every incoming/outgoing message and by ops-api.js
// for the dashboard Chats list, thread view, and JSONL export.
// Needs only Node fs/path/crypto; never throws; never blocks the caller.
//
// Schema (v1) — every line has exactly these keys, nulls where absent:
//   v, ts (ISO), id (Baileys message id), chat (chat JID), sender (sender
//   JID), senderName, direction ("in"|"out"), type ("text"|"image"|"video"|
//   "audio"|"voice"|"document"|"sticker"), text (or null), media (null or
//   { kind, vaultHash, mimetype }).
// Storage: <CHATS_DIR>/<safe-chat-id>/<YYYY-MM-DD>.jsonl + meta.json
// (display name/number) + read.json (lastReadAt for unread counts).
// Caps (SPEC 13): 90 days kept per chat (older day-files pruned on write,
// never the newest file), chat list capped at 200, dedup cache capped at
// 2000 ids, reads bounded (64 KB tail for the list, 5 MB per thread page).
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CHATS_DIR = process.env.LEGEZT_CHATS_DIR || '/var/legezt/storage/chats';
const SCHEMA_VERSION = 1;
const RETENTION_DAYS = 90;
const MAX_LIST_CHATS = 200;
const MAX_SEEN_IDS = 2000;
const LIST_TAIL_BYTES = 64 * 1024;
const PAGE_READ_BYTES = 5 * 1024 * 1024;
const UNREAD_SCAN_LINES = 2000;

// Message ids already archived, newest first (insertion order). Bounded so
// a bot-sent message that also arrives via upsert is never stored twice.
const seenIds = new Set();

function rememberId(id) {
  if (typeof id !== 'string' || id === '') return;
  seenIds.add(id);
  while (seenIds.size > MAX_SEEN_IDS) {
    seenIds.delete(seenIds.keys().next().value);
  }
}

function shaShort(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

// A chat JID becomes a directory name: unsafe chars replaced, plus a short
// hash suffix so two different JIDs can never collide into one directory.
// A JID containing "/" or ".." can never escape CHATS_DIR.
function safeChatId(jid) {
  const base = String(jid || '').replace(/[^A-Za-z0-9@._-]/g, '_').slice(0, 80);
  return `${base || 'chat'}-${shaShort(jid)}`;
}

function chatDir(jid) {
  return path.join(CHATS_DIR, safeChatId(jid));
}

function dayOf(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function dayFile(jid, day) {
  return path.join(chatDir(jid), `${day}.jsonl`);
}

function isValidJid(jid) {
  return typeof jid === 'string'
    && jid.length >= 3 && jid.length <= 100
    && /^[A-Za-z0-9._-]+@(s\.whatsapp\.net|g\.us|lid|c\.us)$/.test(jid);
}

function isGroupJid(jid) {
  return typeof jid === 'string' && jid.endsWith('@g.us');
}

function phoneOf(jid) {
  if (typeof jid !== 'string') return null;
  const at = jid.indexOf('@');
  const local = at === -1 ? jid : jid.slice(0, at);
  return /^\d+$/.test(local) ? local : null;
}

function readJsonFile(file) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function writeJsonFile(file, obj, mode) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(obj), { mode: mode || 0o600 });
    fs.renameSync(tmp, file);
    return true;
  } catch (_) {
    return false;
  }
}

// Day files of one chat, oldest first. Missing dir -> [].
function dayFiles(jid) {
  try {
    const dir = chatDir(jid);
    const names = fs.readdirSync(dir)
      .filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n))
      .sort();
    return names.map((n) => path.join(dir, n));
  } catch (_) {
    return [];
  }
}

function parseLine(line) {
  const trimmed = String(line || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function readLinesTail(file, maxBytes) {
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.size === 0) return [];
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    fs.closeSync(fd);
    return buf.toString('utf8').split('\n').map(parseLine).filter(Boolean);
  } catch (_) {
    return [];
  }
}

// Prune day-files older than RETENTION_DAYS, never the newest file.
// Best-effort: a failed prune never blocks the archive write.
function pruneOldDays(jid) {
  try {
    const files = dayFiles(jid);
    if (files.length <= 1) return;
    const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
      .toISOString().slice(0, 10);
    for (let i = 0; i < files.length - 1; i++) {
      const day = path.basename(files[i]).slice(0, 10);
      if (day < cutoff) {
        try { fs.unlinkSync(files[i]); } catch (_) {}
      }
    }
  } catch (_) {}
}

// Appends one message to the archive. Never throws, never blocks the
// caller on I/O errors. Returns true when the line was stored.
function archive(entry) {
  try {
    if (!entry || typeof entry !== 'object') return false;
    if (!isValidJid(entry.chat)) return false;
    if (typeof entry.id === 'string' && entry.id !== '' && seenIds.has(entry.id)) return false;

    const line = {
      v: SCHEMA_VERSION,
      ts: typeof entry.ts === 'string' && entry.ts !== '' ? entry.ts : new Date().toISOString(),
      id: typeof entry.id === 'string' ? entry.id : null,
      chat: String(entry.chat),
      sender: typeof entry.sender === 'string' && entry.sender !== '' ? entry.sender : null,
      senderName: typeof entry.senderName === 'string' && entry.senderName !== '' ? entry.senderName : null,
      direction: entry.direction === 'out' ? 'out' : 'in',
      type: typeof entry.type === 'string' && entry.type !== '' ? entry.type : 'text',
      text: typeof entry.text === 'string' && entry.text !== '' ? entry.text : null,
      media: entry.media && typeof entry.media === 'object'
        ? {
            kind: typeof entry.media.kind === 'string' ? entry.media.kind : null,
            vaultHash: typeof entry.media.vaultHash === 'string' ? entry.media.vaultHash : null,
            mimetype: typeof entry.media.mimetype === 'string' ? entry.media.mimetype : null
          }
        : null
    };

    const dir = chatDir(line.chat);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    fs.appendFileSync(dayFile(line.chat, dayOf(line.ts)), JSON.stringify(line) + '\n', 'utf8');
    rememberId(line.id);

    // Meta: keep the last-seen time fresh; name/number are filled by
    // noteChatName and never overwritten with null.
    const metaPath = path.join(dir, 'meta.json');
    const meta = readJsonFile(metaPath) || {};
    meta.jid = line.chat;
    meta.isGroup = isGroupJid(line.chat);
    meta.number = phoneOf(line.chat);
    meta.lastTs = line.ts;
    writeJsonFile(metaPath, meta);
    pruneOldDays(line.chat);
    return true;
  } catch (_) {
    return false;
  }
}

// Records a display name for a chat (group subject, or a 1:1 contact's
// pushName). Best-effort; never throws.
function noteChatName(jid, name, isGroup) {
  try {
    if (!isValidJid(jid) || typeof name !== 'string' || name.trim() === '') return false;
    const dir = chatDir(jid);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const metaPath = path.join(dir, 'meta.json');
    const meta = readJsonFile(metaPath) || {};
    meta.jid = jid;
    meta.isGroup = isGroup === true || isGroupJid(jid);
    meta.number = phoneOf(jid);
    meta.name = name.trim().slice(0, 120);
    return writeJsonFile(metaPath, meta);
  } catch (_) {
    return false;
  }
}

// Group subjects, cached (Map, 1h TTL, 500 entries) so the archive path
// never calls groupMetadata on every message. 1:1 chats resolve to null
// (their name comes from the contact's pushName via noteChatName).
const groupNameCache = new Map();

function getChatDisplayName(jid, sock) {
  if (!isGroupJid(jid)) return Promise.resolve(null);
  const now = Date.now();
  const cached = groupNameCache.get(jid);
  if (cached && now - cached.at < 60 * 60 * 1000) return Promise.resolve(cached.name);
  if (!sock || typeof sock.groupMetadata !== 'function') return Promise.resolve(null);
  return sock.groupMetadata(jid).then((meta) => {
    const name = meta && typeof meta.subject === 'string' && meta.subject.trim() !== ''
      ? meta.subject.trim()
      : null;
    groupNameCache.set(jid, { name, at: now });
    while (groupNameCache.size > 500) {
      groupNameCache.delete(groupNameCache.keys().next().value);
    }
    return name;
  }).catch(() => null);
}

function readLastReadAt(jid) {
  const data = readJsonFile(path.join(chatDir(jid), 'read.json'));
  return data && typeof data.lastReadAt === 'string' ? data.lastReadAt : null;
}

// Marks a chat read up to now (or up to the given ISO time). Best-effort.
function markRead(jid, upTo) {
  try {
    if (!isValidJid(jid)) return false;
    const ts = typeof upTo === 'string' && upTo !== '' ? upTo : new Date().toISOString();
    return writeJsonFile(path.join(chatDir(jid), 'read.json'), { lastReadAt: ts });
  } catch (_) {
    return false;
  }
}

// Counts incoming messages newer than lastReadAt, scanning newest first
// and stopping at the first message at or before it (files are append
// ordered, so this is O(unread), not O(history)). Bounded line scan.
function countUnread(jid, lastReadAt) {
  if (!lastReadAt) {
    // Never marked read: unread is everything, capped at the scan bound.
    lastReadAt = '1970-01-01T00:00:00.000Z';
  }
  const files = dayFiles(jid).reverse();
  let unread = 0;
  let scanned = 0;
  for (const file of files) {
    const lines = readLinesTail(file, PAGE_READ_BYTES);
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || typeof line.ts !== 'string') continue;
      if (line.ts <= lastReadAt) return unread;
      scanned += 1;
      if (scanned > UNREAD_SCAN_LINES) return unread;
      if (line.direction === 'in') unread += 1;
    }
  }
  return unread;
}

function previewOf(line) {
  if (!line) return '';
  if (typeof line.text === 'string' && line.text.trim() !== '') {
    return line.text.trim().slice(0, 120);
  }
  if (line.media && typeof line.media.kind === 'string') {
    return `[${line.media.kind}]`;
  }
  return `[${line.type || 'message'}]`;
}

// Chat list, newest message first. Each entry: jid, name, number, isGroup,
// lastTs, lastPreview, lastDirection, unread. Capped at MAX_LIST_CHATS.
function listChats() {
  let dirs = [];
  try {
    dirs = fs.readdirSync(CHATS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch (_) {
    return [];
  }
  const out = [];
  for (const dirName of dirs) {
    const dir = path.join(CHATS_DIR, dirName);
    const meta = readJsonFile(path.join(dir, 'meta.json')) || {};
    const jid = typeof meta.jid === 'string' && isValidJid(meta.jid) ? meta.jid : null;
    if (!jid) continue;
    const files = dayFiles(jid);
    if (files.length === 0) continue;
    const newest = readLinesTail(files[files.length - 1], LIST_TAIL_BYTES);
    const last = newest.length > 0 ? newest[newest.length - 1] : null;
    if (!last || typeof last.ts !== 'string') continue;
    const lastReadAt = readLastReadAt(jid);
    out.push({
      jid,
      name: typeof meta.name === 'string' && meta.name !== '' ? meta.name : null,
      number: phoneOf(jid),
      isGroup: isGroupJid(jid),
      lastTs: last.ts,
      lastPreview: previewOf(last),
      lastDirection: last.direction === 'out' ? 'out' : 'in',
      unread: countUnread(jid, lastReadAt)
    });
  }
  out.sort((a, b) => String(b.lastTs).localeCompare(String(a.lastTs)));
  return out.slice(0, MAX_LIST_CHATS);
}

// One page of a chat's messages, oldest first (chronological reading
// order). `before` is an ISO timestamp cursor: only messages with ts <
// before are returned. hasMore is true when older messages exist.
function readMessages(jid, opts) {
  const options = opts || {};
  const limit = Math.max(1, Math.min(200, Number(options.limit) || 50));
  const before = typeof options.before === 'string' && options.before !== ''
    ? options.before
    : null;
  const files = dayFiles(jid).reverse();
  const collected = [];
  let bytesRead = 0;
  for (const file of files) {
    if (collected.length >= limit + 1 || bytesRead >= PAGE_READ_BYTES) break;
    let lines = [];
    try {
      const stat = fs.statSync(file);
      bytesRead += stat.size;
      lines = readLinesTail(file, PAGE_READ_BYTES);
    } catch (_) {
      lines = [];
    }
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i];
      if (!line || typeof line.ts !== 'string') continue;
      if (before !== null && line.ts >= before) continue;
      collected.push(line);
      if (collected.length >= limit + 1) break;
    }
  }
  collected.sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const hasMore = collected.length > limit;
  const page = hasMore ? collected.slice(1) : collected;
  return {
    messages: page,
    hasMore,
    oldestTs: page.length > 0 ? page[0].ts : null
  };
}

// Day files for export, in streaming order: per chat oldest first; all
// chats grouped by chat (each line carries its chat JID, so a training
// pipeline can regroup or sort by ts). Returns [{ file, bytes }].
function exportFiles(jid) {
  const out = [];
  const addChat = (chatJid) => {
    for (const file of dayFiles(chatJid)) {
      try {
        const stat = fs.statSync(file);
        if (stat.isFile() && stat.size > 0) out.push({ file, bytes: stat.size });
      } catch (_) {}
    }
  };
  if (typeof jid === 'string' && jid !== '') {
    if (!isValidJid(jid)) return null;
    addChat(jid);
    return out;
  }
  const chats = listChats();
  const seen = new Set(chats.map((c) => c.jid));
  for (const chat of chats) addChat(chat.jid);
  // Chats with files but no meta/last line (edge case) still export.
  try {
    for (const dirName of fs.readdirSync(CHATS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory()).map((d) => d.name)) {
      const meta = readJsonFile(path.join(CHATS_DIR, dirName, 'meta.json')) || {};
      if (typeof meta.jid === 'string' && isValidJid(meta.jid) && !seen.has(meta.jid)) {
        addChat(meta.jid);
        seen.add(meta.jid);
      }
    }
  } catch (_) {}
  return out;
}

// Extracts a training-ready archive entry from a Baileys message, or null
// when the message carries nothing worth storing (reactions, protocol
// messages, empty messages). media is { kind, vaultHash, mimetype } from
// autoSaveMedia, or null.
function extractMessage(msg, opts) {
  const options = opts || {};
  if (!msg || typeof msg !== 'object' || !msg.message) return null;
  const inner = msg.message;
  if (inner.reactionMessage || inner.protocolMessage) return null;
  const from = typeof options.from === 'string' ? options.from : null;
  if (!from || !isValidJid(from)) return null;

  let type = null;
  let text = null;
  if (inner.conversation) {
    type = 'text';
    text = inner.conversation;
  } else if (inner.extendedTextMessage) {
    type = 'text';
    text = inner.extendedTextMessage.text || null;
  } else if (inner.imageMessage) {
    type = 'image';
    text = inner.imageMessage.caption || null;
  } else if (inner.videoMessage) {
    type = 'video';
    text = inner.videoMessage.caption || null;
  } else if (inner.audioMessage) {
    type = inner.audioMessage.ptt ? 'voice' : 'audio';
  } else if (inner.documentMessage) {
    type = 'document';
    text = inner.documentMessage.caption || null;
  } else if (inner.stickerMessage) {
    type = 'sticker';
  } else {
    return null;
  }

  const key = msg.key || {};
  const fromMe = key.fromMe === true;
  const isGroup = isGroupJid(from);
  const sender = fromMe
    ? (typeof options.accountJid === 'string' && options.accountJid !== '' ? options.accountJid : 'me')
    : (isGroup && typeof key.participant === 'string' && key.participant !== '' ? key.participant : from);
  const senderName = fromMe
    ? 'LEGEZT'
    : (typeof msg.pushName === 'string' && msg.pushName.trim() !== '' ? msg.pushName.trim() : null);

  let ts = new Date().toISOString();
  const rawTs = msg.messageTimestamp;
  if (typeof rawTs === 'number' && Number.isFinite(rawTs) && rawTs > 0) {
    ts = new Date(rawTs * 1000).toISOString();
  } else if (rawTs && typeof rawTs === 'object' && typeof rawTs.toNumber === 'function') {
    ts = new Date(rawTs.toNumber() * 1000).toISOString();
  }

  const media = options.media && typeof options.media === 'object' && options.media.vaultHash
    ? {
        kind: typeof options.media.kind === 'string' ? options.media.kind : type,
        vaultHash: options.media.vaultHash,
        mimetype: typeof options.media.mimetype === 'string' ? options.media.mimetype : null
      }
    : null;

  return {
    ts,
    id: typeof key.id === 'string' ? key.id : null,
    chat: from,
    sender,
    senderName,
    direction: fromMe ? 'out' : 'in',
    type,
    text: typeof text === 'string' && text.trim() !== '' ? text : null,
    media
  };
}

module.exports = {
  CHATS_DIR,
  SCHEMA_VERSION,
  RETENTION_DAYS,
  safeChatId,
  isValidJid,
  isGroupJid,
  phoneOf,
  archive,
  noteChatName,
  getChatDisplayName,
  listChats,
  readMessages,
  markRead,
  exportFiles,
  extractMessage
};
