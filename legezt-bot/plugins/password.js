// Generates a random password locally with guaranteed character-type coverage.
// Called by the LEGEZT plugin relay for .password commands.
// Needs Node's crypto module and the reply function supplied by the relay.
'use strict';

const crypto = require('crypto');

const { logPluginError } = require('../lib/errors.js');
const USAGE = '.password [length] — e.g. .password 20 (8 to 64)';
const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SYMBOLS = '!@#$%^&*()-_=+';
const ALL_CHARACTERS = LOWERCASE + UPPERCASE + DIGITS + SYMBOLS;

async function respond(reply, message) {
  try {
    await reply(message);
  } catch (_) {
    // The returned text remains available to the relay.
  }
  return message;
}

function randomIndex(max) {
  if (!Number.isInteger(max) || max <= 0 || max > 0x100000000) {
    throw new Error('Invalid random range');
  }

  const range = 0x100000000;
  const limit = range - (range % max);
  let value;

  do {
    value = crypto.randomBytes(4).readUInt32BE(0);
  } while (value >= limit);

  return value % max;
}

function pick(characters) {
  return characters[randomIndex(characters.length)];
}

module.exports = {
  name: 'password',
  command: '.password',
  description: 'Generate a secure random password locally.',
  async run({ log, sock, message, from, text, args, plugins, reply }) {
    try {
      let length = 16;

      if (args.length > 0) {
        const parsed = Number.parseInt(args[0], 10);
        if (Number.isNaN(parsed)) {
          return respond(reply, USAGE);
        }
        length = Math.min(64, Math.max(8, parsed));
      }

      const characters = [
        pick(LOWERCASE),
        pick(UPPERCASE),
        pick(DIGITS),
        pick(SYMBOLS)
      ];

      while (characters.length < length) {
        characters.push(pick(ALL_CHARACTERS));
      }

      for (let index = characters.length - 1; index > 0; index -= 1) {
        const other = randomIndex(index + 1);
        const temporary = characters[index];
        characters[index] = characters[other];
        characters[other] = temporary;
      }

      const output = `Your random password (length ${length}):\n${characters.join('')}`;
      return respond(reply, output);
    } catch (err) {
      logPluginError(log, 'password', err);
      return respond(reply, 'Could not generate a password — try again.');
    }
  }
};
