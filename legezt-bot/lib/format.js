// Shared WhatsApp reply formatter: every bot reply looks the same way.
// Called by plugins (help/menu/about) and by bot.js for common replies.
// Needs nothing — pure text helpers. WhatsApp renders *bold*, _italic_
// and ```monospace```; keep replies short and scannable on a phone.
'use strict';

const DIVIDER = '────────────';
const FOOTER = '🤖 _LEGEZT_';

// A bold title line with an emoji, e.g. "🤖 *LEGEZT Menu*".
function title(emoji, text) {
  return `${emoji} *${text}*`;
}

// A full reply card: title, body lines, divider, footer.
function card(emoji, heading, lines) {
  const body = (Array.isArray(lines) ? lines : [lines])
    .filter((line) => typeof line === 'string' && line !== '');
  return [title(emoji, heading), '', ...body, '', DIVIDER, FOOTER].join('\n');
}

// Success card: ✅ title + body.
function success(heading, lines) {
  return card('✅', heading, lines);
}

// Error card: ❌ title + body, always short and friendly.
function errorCard(heading, lines) {
  return card('❌', heading, lines);
}

// One menu section: "🤖 *AI*" followed by one line per command.
function menuSection(emoji, label, items) {
  const lines = [title(emoji, label)];
  for (const item of items) {
    lines.push(`  ${item.command} — ${item.description}`);
  }
  return lines.join('\n');
}

module.exports = { DIVIDER, FOOTER, title, card, success, errorCard, menuSection };
