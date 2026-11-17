// Computes Levenshtein similarity and chooses typo-tolerant command matches.
// Called by bot.js when a typed command is not found.
// Needs no dependencies or configuration; all matching is pure and in memory.
'use strict';

function levenshteinDistance(a, b) {
  let longer = a;
  let shorter = b;

  if (longer.length < shorter.length) {
    const temporary = longer;
    longer = shorter;
    shorter = temporary;
  }

  let previous = new Array(shorter.length + 1);
  let current = new Array(shorter.length + 1);

  for (let column = 0; column <= shorter.length; column += 1) {
    previous[column] = column;
  }

  for (let row = 1; row <= longer.length; row += 1) {
    current[0] = row;

    for (let column = 1; column <= shorter.length; column += 1) {
      const cost = longer[row - 1] === shorter[column - 1] ? 0 : 1;
      current[column] = Math.min(
        current[column - 1] + 1,
        previous[column] + 1,
        previous[column - 1] + cost
      );
    }

    const temporary = previous;
    previous = current;
    current = temporary;
  }

  return previous[shorter.length];
}

function similarity(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return 0;

  const left = a.trim().toLowerCase();
  const right = b.trim().toLowerCase();

  if (left.length === 0 && right.length === 0) return 1;
  if (left.length === 0 || right.length === 0) return 0;
  if (left === right) return 1;

  const maximumLength = Math.max(left.length, right.length);
  const distance = levenshteinDistance(left, right);
  return 1 - distance / maximumLength;
}

function bestMatch(input, candidates) {
  if (
    typeof input !== 'string' ||
    !Array.isArray(candidates) ||
    candidates.length === 0
  ) {
    return null;
  }

  let bestCandidate = null;
  let bestScore = -1;

  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;

    const score = similarity(input, candidate);
    if (score > bestScore) {
      bestScore = score;
      bestCandidate = candidate;
    }
  }

  if (bestCandidate === null || bestScore < 0.6) return null;
  return { candidate: bestCandidate, score: bestScore };
}

// Suggests the closest known command for a mistyped one (neoxr-style).
// command: the typed command (with or without a leading '.').
// pluginKeys: the loaded plugin commands (e.g. ['.weather', '.ai']).
// Returns '.xxx' when a candidate is at least 60% similar, else null.
function suggestCommand(command, pluginKeys) {
  const normalized = String(command || '').replace(/^\./, '').toLowerCase();
  if (!normalized || !Array.isArray(pluginKeys)) return null;
  const candidates = pluginKeys
    .map((key) => String(key).replace(/^\./, '').toLowerCase())
    .filter(Boolean);
  const match = bestMatch(normalized, candidates);
  return match ? `.${match.candidate}` : null;
}

module.exports = { similarity, bestMatch, suggestCommand };
