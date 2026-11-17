// Encodes or decodes UTF-8 text as base64 without using any remote service.
// Called by the LEGEZT plugin relay for .base64 commands.
// Needs Node's Buffer and the reply function supplied by the relay.
'use strict';


const { logPluginError } = require('../lib/errors.js');
const USAGE = '.base64 <encode|decode> <text> — e.g. .base64 encode hello';
const INVALID_BASE64 = 'That does not look like valid base64.';

async function respond(reply, message) {
  try {
    await reply(message);
  } catch (_) {
    // The returned text remains available to the relay.
  }
  return message;
}

module.exports = {
  name: 'base64',
  command: '.base64',
  description: 'Encode or decode base64 text locally.',
  async run({ log, sock, message, from, text, args, plugins, reply }) {
    try {
      if (args.length < 2) {
        return respond(reply, USAGE);
      }

      const mode = args[0].toLowerCase();
      if (mode !== 'encode' && mode !== 'decode') {
        return respond(reply, USAGE);
      }

      const input = args.slice(1).join(' ').slice(0, 5000);
      let result;

      if (mode === 'encode') {
        result = Buffer.from(input, 'utf8').toString('base64');
      } else {
        const normalized = input.trim();

        if (!/^[A-Za-z0-9+/=]+$/.test(normalized) || normalized.length % 4 !== 0) {
          return respond(reply, INVALID_BASE64);
        }

        try {
          result = Buffer.from(normalized, 'base64').toString('utf8');
          const roundTrip = Buffer.from(result, 'utf8').toString('base64');

          if (result.includes('\uFFFD') || roundTrip !== normalized) {
            return respond(reply, INVALID_BASE64);
          }
        } catch (err) {
          logPluginError(log, 'base64', err);
          return respond(reply, INVALID_BASE64);
        }
      }

      const output = `base64 ${mode}:\n${result.slice(0, 4000)}`;
      return respond(reply, output);
    } catch (err) {
      logPluginError(log, 'base64', err);
      return respond(reply, 'Could not process that base64 text — try again.');
    }
  }
};
