// Limits command attempts per chat+sender key using short flood and minute windows.
// Called by bot.js before command dispatch; returns ok, warn, or ignore.
// Needs only in-memory Date.now() state; call clear() to reset it in tests.
'use strict';

const FLOOD_WINDOW_MS = 6 * 1000;
const MINUTE_WINDOW_MS = 60 * 1000;
const FLOOD_THRESHOLD = 8;
const MINUTE_THRESHOLD = 18;
const MAX_KEYS = 5000;
// Hard cap on the per-chat timestamp list (SPEC 13): the minute filter
// already prunes old entries, but a burst inside one minute could otherwise
// grow the list without bound. Only the most recent entries are kept.
const MAX_TIMES_PER_KEY = 50;

const states = new Map();

// Deletes states whose last activity is older than the minute window, so
// quiet chats never keep an entry forever. Called by bot.js every 60s and
// on every check for the key being checked. Also trims timestamp lists.
function prune() {
  const now = Date.now();
  for (const [key, state] of states) {
    if (!state || now - state.last >= MINUTE_WINDOW_MS) {
      states.delete(key);
      continue;
    }
    const cutoff = now - MINUTE_WINDOW_MS;
    state.times = state.times.filter((timestamp) => timestamp >= cutoff);
    if (state.times.length > MAX_TIMES_PER_KEY) {
      state.times = state.times.slice(-MAX_TIMES_PER_KEY);
    }
  }
}

function check(key) {
  if (typeof key !== 'string' || key.trim().length === 0) return 'ok';

  const now = Date.now();
  let state = states.get(key);

  if (state && now - state.last >= MINUTE_WINDOW_MS) {
    states.delete(key);
    state = null;
  }

  if (state) {
    const cutoff = now - MINUTE_WINDOW_MS;
    state.times = state.times.filter((timestamp) => timestamp >= cutoff);
    if (state.times.length > MAX_TIMES_PER_KEY) {
      state.times = state.times.slice(-MAX_TIMES_PER_KEY);
    }
  }

  if (!state) {
    state = { times: [], last: now, flooding: false };
    states.set(key, state);

    if (states.size > MAX_KEYS) {
      const oldest = states.keys().next().value;
      states.delete(oldest);
    }
  } else if (
    state.flooding &&
    now - state.last >= FLOOD_WINDOW_MS
  ) {
    state.flooding = false;
  }

  state.times.push(now);
  state.last = now;

  if (state.times.length >= MINUTE_THRESHOLD) return 'ignore';
  if (state.flooding) return 'ignore';

  const floodCutoff = now - FLOOD_WINDOW_MS;
  let recentCount = 0;

  for (let index = state.times.length - 1; index >= 0; index -= 1) {
    if (state.times[index] < floodCutoff) break;
    recentCount += 1;
    if (recentCount >= FLOOD_THRESHOLD) break;
  }

  if (recentCount >= FLOOD_THRESHOLD) {
    state.flooding = true;
    return 'warn';
  }

  return 'ok';
}

function clear() {
  states.clear();
}

module.exports = { check, clear, prune };
