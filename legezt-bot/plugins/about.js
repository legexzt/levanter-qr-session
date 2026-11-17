// Replies with a short description of LEGEZT and its loaded command count.
// Called by the LEGEZT plugin loader/relay for the .about command.
// Needs only the standard reply function and the loaded plugins Map.
'use strict';

module.exports = {
  name: 'about',
  command: '.about',
  description: 'Show information about LEGEZT.',
  async run({ plugins, reply }) {
    const commandCount = plugins instanceof Map ? plugins.size : 0;
    const message = [
      '🤖 LEGEZT',
      "The owner's own WhatsApp bot — built on Baileys, not Levanter.",
      'Owner: Mohd Jibraan',
      `Loaded commands: ${commandCount}`,
      'Send .help for the command list and .ping to check it is alive.'
    ].join('\n');

    await reply(message);
    return message;
  }
};
