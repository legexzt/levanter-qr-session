// Provides the short .tr alias by forwarding translation requests to translate.js.
// Called by the LEGEZT plugin relay for .tr commands.
// Needs the sibling translate.js plugin and the original relay context.
'use strict';

const translate = require('./translate.js');

const { logPluginError } = require('../lib/errors.js');
module.exports = {
  name: 'tr',
  command: '.tr',
  description: 'Translate text (same as .translate).',
  async run({ log, sock, message, from, text, args, plugins, reply }) {
    try {
      return await translate.run({
        sock,
        message,
        from,
        text,
        args,
        plugins,
        reply
      });
    } catch (err) {
      logPluginError(log, 'tr', err);
      const output = 'Translation failed, try again in a bit.';
      try {
        await reply(output);
      } catch (__) {
        // The returned text remains available to the relay.
      }
      return output;
    }
  }
};
