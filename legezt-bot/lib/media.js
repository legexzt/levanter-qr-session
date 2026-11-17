// Detects and archives incoming media messages into the encrypted vault.
// Called by bot.js for every incoming message (not just commands).
// Needs Baileys downloadMediaMessage, ../vault.js, ../usage.js; never throws.
'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { saveToVault } = require('../vault.js');
const { logUsage } = require('../usage.js');

// Media the bot auto-saves is capped so one huge file cannot fill the server
// disk. Larger files are skipped with a warning.
const MAX_VAULT_MEDIA_BYTES = 100 * 1024 * 1024;

function extensionForMimetype(mimetype, kind) {
  const known = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/webp': '.webp',
    'image/gif': '.gif',
    'video/mp4': '.mp4',
    'audio/ogg': '.ogg',
    'audio/mpeg': '.mp3',
    'audio/mp4': '.m4a',
    'application/pdf': '.pdf'
  };
  if (typeof mimetype === 'string' && known[mimetype]) return known[mimetype];
  if (kind === 'image') return '.jpg';
  if (kind === 'video') return '.mp4';
  if (kind === 'voice' || kind === 'audio') return '.ogg';
  return '';
}

// Archives a media message (document, image, audio/voice note, video) into
// the vault under <timestamp>_<original-filename> and logs a "media" usage
// event. Returns silently when the message carries no such media. Never throws.
async function autoSaveMedia(msg, from, log) {
  try {
    const inner = msg.message || {};
    let kind = null;
    let fileName = null;
    let mimetype = null;
    if (inner.documentMessage) {
      kind = 'document';
      fileName = inner.documentMessage.fileName || null;
      mimetype = inner.documentMessage.mimetype || null;
    } else if (inner.imageMessage) {
      kind = 'image';
      mimetype = inner.imageMessage.mimetype || null;
    } else if (inner.audioMessage) {
      kind = inner.audioMessage.ptt ? 'voice' : 'audio';
      mimetype = inner.audioMessage.mimetype || null;
    } else if (inner.videoMessage) {
      kind = 'video';
      mimetype = inner.videoMessage.mimetype || null;
    } else {
      return;
    }

    const startedAt = Date.now();
    const buffer = await downloadMediaMessage(msg, 'buffer', {});
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return;
    if (buffer.length > MAX_VAULT_MEDIA_BYTES) {
      if (typeof log === 'function') {
        log('warn', `Media auto-save skipped: ${kind} too large (${buffer.length} bytes)`);
      }
      return;
    }

    const base = fileName
      ? String(fileName)
      : `${kind}${extensionForMimetype(mimetype, kind)}`;
    const vaultName = `${Date.now()}_${base}`;
    const vaultPath = saveToVault(vaultName, buffer);
    logUsage({
      type: 'media',
      command: kind,
      chat: from,
      durationMs: Date.now() - startedAt,
      ok: true,
      file: vaultPath.split('/').pop()
    });
  } catch (err) {
    // A failed media save is logged once and never crashes the bot.
    if (typeof log === 'function') {
      log('error', 'Media auto-save failed: ' + (err && err.message ? String(err.message).slice(0, 200) : 'unknown error'));
    }
  }
}

module.exports = { autoSaveMedia };
