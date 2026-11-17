// Owner's exact .menu / .help template (17 Nov 2026) — the LEGEZT command
// center, rendered verbatim: box-drawing banner, six category boxes, the
// QUICK START box and the footer. Commands are rendered from the loaded
// plugins Map (grouped by category, in the owner's order); the owner's
// descriptions below are canonical — a future plugin falls back to its own
// description, and an uncategorised command goes to SYSTEM & BOT CONTROL.
// Called by plugins/help.js (.help and .menu are the same command center).
// Needs nothing. Do NOT "fix" the banner: the SMART line has no closing ║
// in the owner's template, and it is reproduced exactly as he wrote it.
'use strict';

// Fixed blocks — copied character-for-character from the owner's design.
const BANNER = [
  '╔══════════════════════════╗',
  '║                            ║',
  '║       ⚡ *L E G E Z T*     ║',
  '║       ━━━━━━━━━━━━━        ║',
  '║      🤖 *AI COMMAND CENTER* ║',
  '║                            ║',
  '║    ✦ SMART • POWERFUL • FAST ✦',
  '║                            ║',
  '╚══════════════════════════╝'
].join('\n');

const QUICK_START = [
  '╭──────────────────────────────╮',
  '│       ✦ QUICK START ✦        │',
  '│                              │',
  '│   Type any command to begin. │',
  '│                              │',
  '│   Example: `.ai Hello LEGEZT`│',
  '│                              │',
  '│   Need assistance? `.help`   │',
  '╰──────────────────────────────╯'
].join('\n');

const FOOTER = [
  '       ⚡ *LEGEZT*',
  '   _Where Intelligence Meets Innovation_',
  '',
  '          © LEGEZT BOT'
].join('\n');

const CATEGORY_CLOSE = '└──────────────────────────────┘';

// Category order is the owner's order. `commands` is the owner's order
// inside the box; `description` is the owner's canonical description.
const CATEGORIES = [
  {
    emoji: '🤖',
    title: 'ARTIFICIAL INTELLIGENCE',
    commands: [
      { command: '.ai', description: 'Chat with Kimi K3 AI' },
      { command: '.ask', description: 'Ask anything, get intelligent answers' }
    ]
  },
  {
    emoji: '🌤️',
    title: 'WEATHER INTELLIGENCE',
    commands: [
      { command: '.weather', description: 'Live weather updates by city' }
    ]
  },
  {
    emoji: '🖼️',
    title: 'IMAGE & CREATIVE STUDIO',
    commands: [
      { command: '.img', description: 'Search & send images' },
      { command: '.qr', description: 'Generate QR codes instantly' },
      { command: '.removebg', description: 'Remove image backgrounds' },
      { command: '.sticker', description: 'Create WhatsApp stickers' }
    ]
  },
  {
    emoji: '🎵',
    title: 'MUSIC & ENTERTAINMENT',
    commands: [
      { command: '.song', description: 'Search YouTube & get audio' },
      { command: '.video', description: 'Search & get videos in MP4' }
    ]
  },
  {
    emoji: '🛠️',
    title: 'DEVELOPER TOOLKIT',
    commands: [
      { command: '.base64', description: 'Encode / Decode Base64' },
      { command: '.calc', description: 'Powerful expression calculator' },
      { command: '.password', description: 'Generate secure random passwords' },
      { command: '.tr', description: 'Quick text translation' },
      { command: '.translate', description: 'Translate into any language' },
      { command: '.tts', description: 'Convert text into voice notes' }
    ]
  },
  {
    emoji: '⚙️',
    title: 'SYSTEM & BOT CONTROL',
    commands: [
      { command: '.about', description: 'Discover LEGEZT' },
      { command: '.help', description: 'View all available commands' },
      { command: '.menu', description: 'Open command center' },
      { command: '.ping', description: 'Check system response & latency' }
    ]
  }
];

function categoryHeader(category) {
  return `┌───「 ${category.emoji} ${category.title} 」───┐`;
}

function commandLines(item) {
  return [`  ◈ \`${item.command}\``, `     └ ${item.description}`, ''];
}

function renderMenu(plugins) {
  const byCommand = new Map();
  const list = plugins instanceof Map ? [...plugins.values()] : [];
  for (const plugin of list) {
    if (plugin && typeof plugin.command === 'string') {
      byCommand.set(plugin.command.toLowerCase(), plugin);
    }
  }

  const seen = new Set();
  const lines = [...BANNER.split('\n'), ''];

  for (const category of CATEGORIES) {
    const items = [];
    for (const entry of category.commands) {
      const plugin = byCommand.get(entry.command);
      if (!plugin) continue;
      seen.add(entry.command);
      items.push({ command: plugin.command, description: entry.description });
    }
    if (items.length === 0) continue;
    lines.push(categoryHeader(category), '');
    for (const item of items) {
      lines.push(...commandLines(item));
    }
    lines.push(CATEGORY_CLOSE, '');
  }

  // Anything not categorised (a new plugin) still shows up, under
  // SYSTEM & BOT CONTROL, using its own description.
  const extra = [];
  for (const [key, plugin] of byCommand) {
    if (!seen.has(key)) {
      extra.push({ command: plugin.command, description: plugin.description || '' });
    }
  }
  if (extra.length > 0) {
    extra.sort((a, b) => a.command.localeCompare(b.command));
    const system = CATEGORIES[CATEGORIES.length - 1];
    lines.push(categoryHeader(system), '');
    for (const item of extra) {
      lines.push(...commandLines(item));
    }
    lines.push(CATEGORY_CLOSE, '');
  }

  lines.push(...QUICK_START.split('\n'), '', ...FOOTER.split('\n'));
  return lines.join('\n');
}

module.exports = { BANNER, QUICK_START, FOOTER, CATEGORIES, renderMenu };
