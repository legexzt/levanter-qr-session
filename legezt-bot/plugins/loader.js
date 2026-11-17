// Loads and validates LEGEZT bot plugins, skipping broken files so they cannot crash the bot.
// Called once by bot.js at startup through loadPlugins(pluginDir, log).
// Needs only fs, path, and an optional log function (timestamped console logging by default).
'use strict';

const fs = require('fs');
const path = require('path');

function defaultLog(message) {
  console.log(`[${new Date().toISOString()}] ${message}`);
}

function loadPlugins(pluginDir, log) {
  const logger = typeof log === 'function' ? log : defaultLog;
  const plugins = new Map();
  const list = [];
  // Resolve to an absolute path: require() below is relative to this file,
  // so a relative pluginDir would otherwise resolve to plugins/plugins/.
  const dir = path.resolve(pluginDir);
  let entries;

  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      logger(`[WARN] Plugin directory does not exist or is not a directory: ${dir}`);
      return { plugins, list };
    }
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    logger(`[WARN] Unable to read plugin directory ${dir}: ${message}`);
    return { plugins, list };
  }

  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js') && entry.name !== 'loader.js')
    .map((entry) => entry.name)
    .sort();

  for (const file of files) {
    try {
      const mod = require(path.join(dir, file));
      let reason = null;

      if (!mod || typeof mod !== 'object' || Array.isArray(mod)) {
        reason = 'module export must be an object';
      } else if (typeof mod.name !== 'string' || mod.name.trim().length === 0) {
        reason = 'name must be a non-empty string';
      } else if (
        typeof mod.command !== 'string' ||
        mod.command.trim().length === 0 ||
        !mod.command.startsWith('.')
      ) {
        reason = 'command must be a non-empty string starting with .';
      } else if (typeof mod.description !== 'string') {
        reason = 'description must be a string';
      } else if (typeof mod.run !== 'function') {
        reason = 'run must be a function';
      }

      if (reason) {
        logger(`Plugin ${file} skipped: ${reason}`);
        continue;
      }

      if (mod.enabled === false) {
        logger(`Plugin ${mod.name} (${mod.command}) disabled — skipped`);
        continue;
      }

      const key = mod.command.toLowerCase();
      const existing = plugins.get(key);
      if (existing) {
        logger(
          `Plugin ${mod.name} skipped: command ${mod.command} already taken by ${existing.name}`
        );
        continue;
      }

      plugins.set(key, mod);
      list.push(mod);
      logger(`Plugin loaded: ${mod.name} (${mod.command}) — ${mod.description}`);
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      logger(`Plugin ${file} failed to load: ${message}`);
    }
  }

  return { plugins, list };
}

function describePlugins(list) {
  return (Array.isArray(list) ? list : []).map((plugin) => ({
    name: plugin.name,
    command: plugin.command,
    description: plugin.description,
  }));
}

module.exports = { loadPlugins, describePlugins };
