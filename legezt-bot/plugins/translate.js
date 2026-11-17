// Translates text through the free Google Translate endpoint and replies with the result.
// Called by the LEGEZT plugin relay for .translate commands.
// Needs Node 20+ global fetch and the reply function supplied by the relay.
'use strict';


const { logPluginError } = require('../lib/errors.js');
const USAGE = '.translate <lang> <text> — e.g. .translate hi good morning';
const INVALID_LANG = 'Use a 2-letter language code — e.g. en, hi, ur, es, fr.';
const PARSE_ERROR = 'Translation failed, try again.';
const NETWORK_ERROR = 'Translation failed, try again in a bit.';

async function respond(reply, message) {
  try {
    await reply(message);
  } catch (_) {
    // The returned text remains available to the relay.
  }
  return message;
}

module.exports = {
  name: 'translate',
  command: '.translate',
  description: 'Translate text into another language.',
  async run({ log, sock, message, from, text, args, plugins, reply }) {
    try {
      if (args.length < 2) {
        return respond(reply, USAGE);
      }

      const requestedLang = args[0];
      if (!/^[a-z]{2}(-[A-Z]{2})?$/i.test(requestedLang)) {
        return respond(reply, INVALID_LANG);
      }

      const lang = requestedLang.toLowerCase();
      const input = args.slice(1).join(' ').slice(0, 1000);
      if (!input.trim()) {
        return respond(reply, USAGE);
      }

      const url = 'https://translate.googleapis.com/translate_a/single'
        + '?client=gtx&sl=auto&tl=' + encodeURIComponent(lang)
        + '&dt=t&q=' + encodeURIComponent(input);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let data;

      try {
        const response = await fetch(url, { signal: controller.signal });
        if (!response.ok) {
          throw new Error('Translation HTTP error');
        }

        try {
          data = await response.json();
        } catch (err) {
          logPluginError(log, 'translate', err);
          return respond(reply, PARSE_ERROR);
        }
      } catch (err) {
        logPluginError(log, 'translate', err);
        return respond(reply, NETWORK_ERROR);
      } finally {
        clearTimeout(timer);
      }

      let translated;
      let sourceLang = 'auto';

      try {
        if (!Array.isArray(data) || !Array.isArray(data[0])) {
          throw new Error('Unexpected translation response');
        }

        translated = data[0].map((part) => {
          if (Array.isArray(part) && typeof part[0] === 'string') {
            return part[0];
          }
          return '';
        }).join('').trim();

        if (typeof data[2] === 'string' && data[2].trim()) {
          sourceLang = data[2];
        }
      } catch (err) {
        logPluginError(log, 'translate', err);
        return respond(reply, PARSE_ERROR);
      }

      if (!translated) {
        return respond(reply, PARSE_ERROR);
      }

      const output = `${translated}\n(from ${sourceLang} → ${lang})`.slice(0, 4000);
      return respond(reply, output);
    } catch (err) {
      logPluginError(log, 'translate', err);
      return respond(reply, NETWORK_ERROR);
    }
  }
};
