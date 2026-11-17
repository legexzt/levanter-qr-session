// Converts text to speech with Google TTS and sends it as a WhatsApp voice note.
// Called by the LEGEZT plugin relay for .tts commands.
// Needs Node 20+ global fetch, a Baileys socket, and the quoted message.
'use strict';


const { logPluginError } = require('../lib/errors.js');
const USAGE = '.tts <text> — e.g. .tts hello, how are you';
const CREATE_ERROR = 'Could not make the voice note — try again.';
const SEND_ERROR = 'Could not send the voice note — try again.';
const MAX_AUDIO_BYTES = 2 * 1024 * 1024;

async function respond(reply, message) {
  try {
    await reply(message);
  } catch (_) {
    // The returned text remains available to the relay.
  }
  return message;
}

async function readAudio(response) {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > MAX_AUDIO_BYTES) {
    throw new Error('Audio response is too large');
  }

  if (response.body && typeof response.body.getReader === 'function') {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      const chunk = Buffer.from(value);
      total += chunk.length;

      if (total > MAX_AUDIO_BYTES) {
        try {
          await reader.cancel();
        } catch (_) {
          // The size error below is the useful failure.
        }
        throw new Error('Audio response is too large');
      }

      chunks.push(chunk);
    }

    return Buffer.concat(chunks, total);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new Error('Audio response is too large');
  }
  return buffer;
}

module.exports = {
  name: 'tts',
  command: '.tts',
  description: 'Make a voice note from text, with an optional language.',
  async run({ log, sock, message, from, text, args, plugins, reply }) {
    try {
      if (args.length < 1) {
        return respond(reply, USAGE);
      }

      let lang = 'en';
      let words = args;

      if (args.length >= 2 && /^[a-z]{2}$/i.test(args[0])) {
        lang = args[0].toLowerCase();
        words = args.slice(1);
      }

      const input = words.join(' ').trim().slice(0, 200);
      if (!input) {
        return respond(reply, USAGE);
      }

      const url = 'https://translate.google.com/translate_tts'
        + '?ie=UTF-8&client=tw-ob&tl=' + encodeURIComponent(lang)
        + '&q=' + encodeURIComponent(input);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      let audioBuffer;

      try {
        const response = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0' }
        });

        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (!response.ok || !contentType.startsWith('audio/')) {
          throw new Error('TTS did not return audio');
        }

        audioBuffer = await readAudio(response);
        if (audioBuffer.length === 0) {
          throw new Error('TTS returned empty audio');
        }
      } catch (err) {
        logPluginError(log, 'tts', err);
        return respond(reply, CREATE_ERROR);
      } finally {
        clearTimeout(timer);
      }

      try {
        await sock.sendMessage(from, {
          audio: audioBuffer,
          mimetype: 'audio/mpeg',
          ptt: true
        }, { quoted: message });
      } catch (err) {
        logPluginError(log, 'tts', err);
        return respond(reply, SEND_ERROR);
      }

      return 'Voice note sent 🔊';
    } catch (err) {
      logPluginError(log, 'tts', err);
      return respond(reply, CREATE_ERROR);
    }
  }
};
