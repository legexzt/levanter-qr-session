// Removes an image background using the remove.bg API.
// Called by the LEGEZT plugin relay when a user runs .removebg.
// Needs a configured remove.bg key, Baileys media downloads, and global fetch.
'use strict';

const { downloadMediaMessage } = require('@whiskeysockets/baileys');
const { getKey } = require('../lib/keys.js');

const { logPluginError } = require('../lib/errors.js');
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const REMOVEBG_TIMEOUT_MS = 15000;

function getMediaTarget(message, from) {
  // Returns a Baileys message object whose media can be downloaded, or null.
  // Case 1: the message itself is an image/video (caption holds the command).
  const direct = message && message.message;
  if (direct && (direct.imageMessage || direct.videoMessage)) return message;
  // Case 2: the message is a text reply quoting an image/video.
  const ctx = direct && direct.extendedTextMessage && direct.extendedTextMessage.contextInfo;
  const quoted = ctx && ctx.quotedMessage;
  if (quoted && (quoted.imageMessage || quoted.videoMessage)) {
    return {
      key: { remoteJid: from, id: ctx.stanzaId || '', fromMe: false, participant: ctx.participant || undefined },
      message: quoted
    };
  }
  return null;
}

async function respond(reply, text) {
  try {
    await reply(text);
  } catch (_) {
    // The returned text still lets the relay path provide the response.
  }
  return text;
}

async function callRemoveBg(key, imageBuffer) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REMOVEBG_TIMEOUT_MS);

  try {
    const form = new FormData();
    form.append('image_file_b64', imageBuffer.toString('base64'));
    form.append('size', 'auto');

    const response = await fetch('https://api.remove.bg/v1.0/removebg', {
      method: 'POST',
      headers: { 'X-Api-Key': key },
      body: form,
      signal: controller.signal
    });

    if (!response.ok) {
      try {
        await response.json();
      } catch (_) {
        // Error bodies are optional and are never exposed to the user.
      }
      return { ok: false, status: response.status };
    }

    const pngBuffer = Buffer.from(await response.arrayBuffer());
    return { ok: true, buffer: pngBuffer };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  name: 'removebg',
  command: '.removebg',
  description: 'Remove the background from an image.',

  async run({ log, sock, message, from, text, args, plugins, reply }) {
    try {
      const key = getKey('removebg');
      if (!key) {
        return respond(
          reply,
          'Remove-background key not configured yet — ask the owner to add it.'
        );
      }

      const target = getMediaTarget(message, from);
      if (!target) {
        return respond(
          reply,
          'Send .removebg as the caption of an image, or reply .removebg to an image.'
        );
      }

      if (target.message && target.message.videoMessage) {
        return respond(reply, 'Send an image, not a video.');
      }

      let imageBuffer;
      try {
        imageBuffer = await downloadMediaMessage(target, 'buffer', {});
      } catch (err) {
        logPluginError(log, 'removebg', err);
        return respond(
          reply,
          'Could not download that image — try sending it again.'
        );
      }

      if (imageBuffer.length > MAX_IMAGE_BYTES) {
        return respond(reply, 'That image is too big (max 10MB).');
      }

      let result;
      try {
        result = await callRemoveBg(key, imageBuffer);
      } catch (err) {
        logPluginError(log, 'removebg', err);
        return respond(reply, 'Background removal failed, try again in a bit.');
      }

      if (!result.ok) {
        logPluginError(log, 'removebg', new Error('remove.bg HTTP ' + result.status));
        if (result.status === 402) {
          return respond(
            reply,
            'Remove-background credits are used up for this month.'
          );
        }
        if (result.status === 403) {
          return respond(
            reply,
            'Remove-background key is not valid — ask the owner to check it.'
          );
        }
        return respond(reply, 'Background removal failed, try again in a bit.');
      }

      try {
        await sock.sendMessage(
          from,
          {
            image: result.buffer,
            mimetype: 'image/png',
            caption: 'Background removed ✅'
          },
          { quoted: message }
        );
      } catch (err) {
        logPluginError(log, 'removebg', err);
        return respond(reply, 'Could not send the result — try again.');
      }

      return undefined;
    } catch (err) {
      logPluginError(log, 'removebg', err);
      return respond(reply, 'Background removal failed, try again in a bit.');
    }
  }
};
