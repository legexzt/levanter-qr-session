// .help — lists every loaded bot command with its description.
// Called by bot.js when a WhatsApp message (or a Muse relay call) starts with .help.
// Needs the loaded plugins map passed in the run context.
'use strict';

module.exports = {
  name: 'help',
  command: '.help',
  description: 'List all available commands.',
  async run({ plugins, reply }) {
    const lines = ['LEGEZT commands:'];
    const list = plugins instanceof Map ? [...plugins.values()] : [];
    if (list.length === 0) {
      lines.push('(no commands loaded)');
    } else {
      for (const plugin of list) {
        lines.push(`• ${plugin.command} — ${plugin.description || ''}`.trim());
      }
    }
    lines.push('Send a command to run it.');
    const text = lines.join('\n');
    await reply(text);
    return text;
  }
};
