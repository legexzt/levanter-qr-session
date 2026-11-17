// .help — grouped, eye-catching command menu for WhatsApp.
// Called by bot.js when a WhatsApp message (or a Muse relay call) starts
// with .help or .menu. Needs the loaded plugins map passed in the run
// context, and lib/format.js for the shared reply style.
// Categories are keyed by command name; a plugin the map does not know
// yet falls into "Bot", so new plugins always appear automatically.
'use strict';

const { title, menuSection, DIVIDER, FOOTER } = require('../lib/format.js');

// Category order is the order shown on the phone. Keep it short.
const CATEGORIES = [
  { emoji: '🤖', label: 'AI', commands: ['.ai', '.ask'] },
  { emoji: '🌤️', label: 'Weather', commands: ['.weather'] },
  { emoji: '🖼️', label: 'Images', commands: ['.img', '.removebg', '.sticker', '.qr'] },
  { emoji: '🎵', label: 'Music & Video', commands: ['.song', '.video'] },
  { emoji: '🛠️', label: 'Tools', commands: ['.translate', '.tr', '.tts', '.calc', '.password', '.base64'] },
  { emoji: '⚙️', label: 'Bot', commands: ['.ping', '.help', '.menu', '.about'] }
];

function buildMenu(plugins) {
  const list = plugins instanceof Map ? [...plugins.values()] : [];
  const byCommand = new Map();
  for (const plugin of list) {
    if (plugin && typeof plugin.command === 'string') {
      byCommand.set(plugin.command.toLowerCase(), plugin);
    }
  }

  const seen = new Set();
  const sections = [];
  for (const category of CATEGORIES) {
    const items = [];
    for (const command of category.commands) {
      const plugin = byCommand.get(command);
      if (!plugin) continue;
      seen.add(command);
      items.push({ command: plugin.command, description: plugin.description || '' });
    }
    if (items.length > 0) {
      items.sort((a, b) => a.command.localeCompare(b.command));
      sections.push(menuSection(category.emoji, category.label, items));
    }
  }

  // Anything not in the map (a new plugin) still shows up, under Bot.
  const extra = [];
  for (const [command, plugin] of byCommand) {
    if (!seen.has(command)) {
      extra.push({ command: plugin.command, description: plugin.description || '' });
    }
  }
  if (extra.length > 0) {
    extra.sort((a, b) => a.command.localeCompare(b.command));
    sections.push(menuSection('⚙️', 'Bot', extra));
  }

  if (sections.length === 0) {
    return [title('🤖', 'LEGEZT Menu'), '', '(no commands loaded)', '', DIVIDER, FOOTER].join('\n');
  }

  return [
    title('🤖', 'LEGEZT Menu'),
    '',
    ...sections,
    '',
    'Send a command to run it. Type _.help_ anytime.',
    '',
    DIVIDER,
    FOOTER
  ].join('\n');
}

module.exports = {
  name: 'help',
  command: '.help',
  description: 'List all available commands.',
  async run({ plugins, reply }) {
    const text = buildMenu(plugins);
    await reply(text);
    return text;
  }
};
