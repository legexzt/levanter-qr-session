// Decides what to do when the Baileys socket closes, by disconnect reason.
// Called by bot.js _onConnectionUpdate. Pure logic — no I/O, easy to test.
// Requires nothing. The codes come from the installed Baileys 6.7.24
// DisconnectReason enum (verified from the package, not guessed):
//   401 loggedOut, 403 forbidden, 408 timedOut/connectionLost,
//   411 multideviceMismatch, 428 connectionClosed, 440 connectionReplaced,
//   500 badSession, 503 unavailableService, 515 restartRequired.
// P0 (CRASH_ANALYSIS_REPORT.md F-08/F-09/F-10): the old code had one branch
// (401 -> stop, everything else -> reconnect with backoff). That retried a
// forbidden account forever, fought a replaced session, and killed itself
// on the 515 -> 401 false-logout sequence. Each reason now has its own rule.
'use strict';

// Terminal: stop, do not reconnect. The owner must act (re-scan or fix the
// account). Retrying any of these is harmful or pointless.
const TERMINAL = new Set([401, 403, 411, 440]);
// Immediate: reconnect now, no backoff, do not count the attempt.
const IMMEDIATE = new Set([515]);
// Backoff: reconnect with exponential backoff.
const BACKOFF = new Set([408, 428, 503, 500]);

// 515-guard window (ms). A 401 arriving within this long after a 515 is
// WhatsApp cleaning up the OLD session slot, not a real logout
// (Evolution API PR #2509). Only the FIRST such 401 is ignored.
const FALSE_LOGOUT_WINDOW_MS = 30000;

// After this many consecutive badSession (500) closes with no backup to
// restore from, stop instead of looping forever on a corrupt session.
// (A session backup + restore is P1, F-13; until it exists, cap the loop.)
const MAX_CONSECUTIVE_BAD_SESSION = 5;

// ctx: { recent515: boolean, ignored401After515: boolean,
//        consecutiveBadSession: number }
// Returns { action: 'stop' | 'immediate' | 'backoff', reason: string }.
function decideReconnect(code, ctx = {}) {
  const recent515 = !!ctx.recent515;
  const ignored401After515 = !!ctx.ignored401After515;

  if (code === 401) {
    if (recent515 && !ignored401After515) {
      return {
        action: 'immediate',
        reason: '401 within 30s of a 515 — false logout (old session cleanup), ignored once, reconnecting'
      };
    }
    return { action: 'stop', reason: 'logged out — fresh scan needed' };
  }
  if (code === 403) {
    return { action: 'stop', reason: 'forbidden — account restricted, do NOT retry (retrying can deepen it)' };
  }
  if (code === 411) {
    return { action: 'stop', reason: 'multidevice mismatch — owner action needed' };
  }
  if (code === 440) {
    return { action: 'stop', reason: 'session replaced elsewhere — stop to avoid fighting the other session' };
  }
  if (code === 500) {
    const n = ctx.consecutiveBadSession || 0;
    if (n >= MAX_CONSECUTIVE_BAD_SESSION) {
      return { action: 'stop', reason: `bad session repeated ${n} times with no backup to restore — owner action needed` };
    }
    return { action: 'backoff', reason: 'bad session — reconnect with backoff (no session backup yet, P1 F-13)' };
  }
  if (IMMEDIATE.has(code)) {
    return { action: 'immediate', reason: 'restart required — reconnect now, no backoff' };
  }
  if (BACKOFF.has(code)) {
    return { action: 'backoff', reason: `reconnect with backoff (code ${code})` };
  }
  return { action: 'backoff', reason: `unknown close code ${code} — reconnect with backoff` };
}

module.exports = {
  decideReconnect,
  TERMINAL,
  IMMEDIATE,
  BACKOFF,
  FALSE_LOGOUT_WINDOW_MS,
  MAX_CONSECUTIVE_BAD_SESSION
};
