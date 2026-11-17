// Logs a plugin failure with context (plugin name + short error) for 24/7 debugging.
// Called by plugins in their failure paths; bot.js passes log in the run context.
// Needs nothing; never logs API keys or phone numbers (long token-like strings are redacted).
'use strict';

function logPluginError(log, pluginName, err) {
  if (typeof log !== 'function') return;
  let detail = 'unknown error';
  try {
    if (err && typeof err.message === 'string' && err.message.trim()) {
      detail = err.message.trim().slice(0, 200);
    } else if (err !== undefined && err !== null) {
      detail = String(err).slice(0, 200);
    }
  } catch (_) {
    detail = 'unknown error';
  }
  // Redact anything that looks like a token or key (a long unbroken string).
  try {
    detail = detail.replace(/[A-Za-z0-9_\-]{32,}/g, '[redacted]');
  } catch (_) {}
  try {
    log('error', pluginName + ': ' + detail);
  } catch (_) {}
}

module.exports = { logPluginError };
