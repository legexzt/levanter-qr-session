// .help — the owner's exact LEGEZT command-center menu for WhatsApp.
// Called by bot.js when a WhatsApp message (or a Muse relay call) starts
// with .help or .menu. Needs the loaded plugins map passed in the run
// context, and lib/menu-template.js for the owner's verbatim template.
// New plugins still appear automatically (SYSTEM & BOT CONTROL).
'use strict';

const { renderMenu } = require('../lib/menu-template.js');

module.exports = {
  name: 'help',
  command: '.help',
  description: 'List all available commands.',
  async run({ plugins, reply }) {
    const text = renderMenu(plugins);
    await reply(text);
    return text;
  }
};
