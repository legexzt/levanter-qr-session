// Encrypts/decrypts files with AES-256-GCM for the LEGEZT secret vault.
// Called by bot.js (via lib/media.js) to auto-save incoming media; the key
// lives in /var/legezt/config/vault.key (32 bytes, mode 600, created by deploy.sh).
// Needs Node crypto/fs; the key value is never logged, never committed.
//
// Data structures (SPEC 13):
// - Index: a Map keyed by content hash (SHA-256) -> { name, storedAt, size,
//   originalName }. Persisted to <vault>/index.json (mode 600) so dedup
//   survives restarts; written atomically (temp file + rename). Lookup is by
//   hash, never by scanning the directory. The same content is stored once:
//   a second save of identical bytes returns the existing vault path.
// - The vault file keeps its first <timestamp>_<original-filename> name
//   (SPEC 12); the index records that name plus the hash and time.
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const VAULT_KEY_FILE = process.env.LEGEZT_VAULT_KEY_FILE || '/var/legezt/config/vault.key';
const VAULT_DIR = process.env.LEGEZT_VAULT_DIR || '/var/legezt/storage/vault';
const INDEX_FILE = path.join(VAULT_DIR, 'index.json');

let cachedKey = null;
let index = null;

function getKey() {
  if (cachedKey) return cachedKey;
  const key = fs.readFileSync(VAULT_KEY_FILE);
  if (!Buffer.isBuffer(key) || key.length !== 32) {
    throw new Error('vault key must be 32 bytes');
  }
  cachedKey = key;
  return cachedKey;
}

function hashBuffer(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sanitizeName(name) {
  const base = path.basename(String(name || 'file'));
  const clean = base.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '').slice(0, 200);
  return clean || 'file';
}

function loadIndex() {
  if (index) return index;
  index = new Map();
  try {
    const raw = fs.readFileSync(INDEX_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      for (const [hash, entry] of Object.entries(parsed)) {
        if (entry && typeof entry.name === 'string') index.set(hash, entry);
      }
    }
  } catch (_) {
    // Missing or corrupt index: start empty (existing vault files stay on
    // disk; they are re-indexed only if saved again under a new hash).
  }
  return index;
}

function persistIndex() {
  const obj = {};
  for (const [hash, entry] of index) obj[hash] = entry;
  const tmp = INDEX_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj), { mode: 0o600 });
  fs.renameSync(tmp, INDEX_FILE);
}

// Finds a vault entry by content hash. Returns { name, storedAt, size,
// originalName } or null. O(1) — no directory scan.
function findByHash(hash) {
  if (typeof hash !== 'string' || !hash) return null;
  const idx = loadIndex();
  return idx.get(hash) || null;
}

// Encrypts buffer and writes it to the vault. Returns the vault file path.
// If identical content is already stored, the existing path is returned and
// nothing is written again (dedup). File layout: [iv 12][auth tag 16][ciphertext].
function saveToVault(name, buffer) {
  if (!Buffer.isBuffer(buffer)) throw new Error('vault data must be a Buffer');
  const key = getKey();
  const hash = hashBuffer(buffer);
  const idx = loadIndex();
  const existing = idx.get(hash);
  if (existing && typeof existing.name === 'string') {
    const existingPath = path.join(VAULT_DIR, existing.name);
    try {
      if (fs.existsSync(existingPath)) return existingPath;
    } catch (_) {
      // Fall through and re-store if the check fails.
    }
    idx.delete(hash);
  }

  const safeName = sanitizeName(name);
  fs.mkdirSync(VAULT_DIR, { recursive: true, mode: 0o700 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  const stored = Buffer.concat([iv, tag, ciphertext]);
  const vaultPath = path.join(VAULT_DIR, safeName);
  fs.writeFileSync(vaultPath, stored, { mode: 0o600 });

  idx.set(hash, {
    name: safeName,
    storedAt: new Date().toISOString(),
    size: buffer.length,
    originalName: String(name || '')
  });
  persistIndex();
  return vaultPath;
}

// Decrypts a vault file by name and returns its contents as a Buffer.
// Throws if the file is missing, the key is wrong, or the data was tampered with.
function readFromVault(name) {
  const key = getKey();
  const safeName = sanitizeName(name);
  const vaultPath = path.join(VAULT_DIR, safeName);
  const stored = fs.readFileSync(vaultPath);
  if (stored.length < 28) throw new Error('vault file is too short');
  const iv = stored.subarray(0, 12);
  const tag = stored.subarray(12, 28);
  const ciphertext = stored.subarray(28);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// Decrypts a vault file by content hash. Returns the Buffer or null when the
// hash is not in the index.
function readByHash(hash) {
  const entry = findByHash(hash);
  if (!entry) return null;
  return readFromVault(entry.name);
}

module.exports = { saveToVault, readFromVault, findByHash, readByHash, hashBuffer };
