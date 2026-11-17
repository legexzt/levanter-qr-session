// Reads and caches LEGEZT API keys from environment variables or server config files.
// Called by lib/ai.js and command plugins that need provider credentials.
// Needs Node fs/path and LEGEZT_CONFIG_DIR or /var/legezt/config; key values are never logged.
'use strict';

const fs = require('fs');
const path = require('path');

const CACHE_TTL_MS = 60 * 1000;
const DEFAULT_CONFIG_DIR = '/var/legezt/config';
const fileCache = new Map();

function normalizeName(name) {
  if (typeof name !== 'string') return null;

  const normalized = name.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(normalized)) return null;
  return normalized;
}

function readEnvKeys(name) {
  // Both <NAME>_KEY and <NAME>_API_KEY are accepted, e.g. BEDROCK_KEY and
  // BEDROCK_API_KEY (the deploy.sh env var name). Comma-separated lists
  // are supported so several keys can rotate.
  const raws = [
    process.env[name.toUpperCase() + '_KEY'],
    process.env[name.toUpperCase() + '_API_KEY']
  ];

  const keys = [];
  for (const raw of raws) {
    if (typeof raw !== 'string') continue;
    for (const part of raw.split(',')) {
      const trimmed = part.trim();
      if (trimmed.length > 0) keys.push(trimmed);
    }
  }
  return keys;
}

function readFileKeys(name) {
  const now = Date.now();
  let filePath;

  try {
    const configDir = process.env.LEGEZT_CONFIG_DIR || DEFAULT_CONFIG_DIR;
    filePath = path.join(configDir, name + '.key');
  } catch {
    return [];
  }

  const cached = fileCache.get(name);
  if (
    cached &&
    cached.filePath === filePath &&
    now - cached.readAt < CACHE_TTL_MS
  ) {
    return cached.keys;
  }

  let keys = [];
  try {
    const text = fs.readFileSync(filePath, 'utf8');
    keys = text
      .split(/\r\n|\n|\r/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
  } catch {
    keys = [];
  }

  fileCache.set(name, { readAt: now, filePath, keys });
  return keys;
}

function getKey(name) {
  const normalized = normalizeName(name);
  if (!normalized) return null;

  const envKeys = readEnvKeys(normalized);
  if (envKeys.length > 0) return envKeys[0];

  const fileKeys = readFileKeys(normalized);
  return fileKeys.length > 0 ? fileKeys[0] : null;
}

function getKeys(name) {
  const normalized = normalizeName(name);
  if (!normalized) return [];

  const combined = readEnvKeys(normalized).concat(readFileKeys(normalized));
  return Array.from(new Set(combined));
}

function clearCache() {
  fileCache.clear();
}

module.exports = { getKey, getKeys, clearCache };
